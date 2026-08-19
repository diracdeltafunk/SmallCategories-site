#!/usr/bin/env python3
"""Create a read-only, static-site export from the SmallCats Postgres database."""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from datetime import datetime, timezone

try:
    import psycopg
except ImportError:
    print(
        "Missing psycopg. Install static-site/requirements-export.txt in a virtual environment first.",
        file=sys.stderr,
    )
    raise SystemExit(2)


MAX_PROPOSITIONS = 32


def compact_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def write_json(path: Path, value: object) -> None:
    path.write_text(f"{compact_json(value)}\n", encoding="utf-8")


def table_digest(table: object) -> str:
    serialized = compact_json(table).encode("utf-8")
    return hashlib.sha256(serialized).hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export public SmallCats data without modifying Supabase."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "export",
        help="output directory (default: static-site/export)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="replace an existing output directory",
    )
    return parser.parse_args()


def database_url() -> str:
    value = os.environ.get("SMALLCATS_DATABASE_URL")
    if value:
        return value
    return getpass.getpass(
        "Paste the Supabase Postgres connection string (input is hidden): "
    ).strip()


def export_database(connection_string: str, output: Path) -> dict[str, int]:
    with psycopg.connect(connection_string, application_name="smallcats-static-export") as conn:
        conn.execute(
            "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
        )

        proposition_rows = conn.execute(
            '''
            SELECT id::text, name, description
            FROM "Propositions"
            ORDER BY id
            '''
        ).fetchall()
        if len(proposition_rows) > MAX_PROPOSITIONS:
            raise RuntimeError(
                f"The static format supports at most {MAX_PROPOSITIONS} propositions; "
                f"the database has {len(proposition_rows)}."
            )

        propositions = [
            {
                "id": row[0],
                "name": row[1],
                "description": row[2],
                "bit": bit,
            }
            for bit, row in enumerate(proposition_rows)
        ]
        write_json(output / "propositions.json", propositions)

        category_count = conn.execute(
            'SELECT count(*) FROM "Categories"'
        ).fetchone()[0]
        relation_count = conn.execute(
            'SELECT count(*) FROM "KnowledgeBase"'
        ).fetchone()[0]
        invalid_relations = conn.execute(
            '''
            SELECT
                count(*) FILTER (WHERE c.id IS NULL),
                count(*) FILTER (WHERE p.id IS NULL),
                count(*) FILTER (WHERE kb.value IS NULL)
            FROM "KnowledgeBase" AS kb
            LEFT JOIN "Categories" AS c ON c.id = kb.category
            LEFT JOIN "Propositions" AS p ON p.id = kb.proposition
            '''
        ).fetchone()
        duplicate_relations = conn.execute(
            '''
            SELECT count(*)
            FROM (
                SELECT category, proposition
                FROM "KnowledgeBase"
                GROUP BY category, proposition
                HAVING count(*) > 1
            ) AS duplicates
            '''
        ).fetchone()[0]
        duplicate_coordinates = conn.execute(
            '''
            SELECT count(*)
            FROM (
                SELECT morphisms, objects, "index"
                FROM "Categories"
                GROUP BY morphisms, objects, "index"
                HAVING count(*) > 1
            ) AS duplicates
            '''
        ).fetchone()[0]

        problems = {
            "facts with missing categories": invalid_relations[0],
            "facts with missing propositions": invalid_relations[1],
            "facts with null truth values": invalid_relations[2],
            "duplicate category/proposition facts": duplicate_relations,
            "duplicate category coordinates": duplicate_coordinates,
        }
        present_problems = {label: count for label, count in problems.items() if count}
        if present_problems:
            details = ", ".join(
                f"{label}: {count}" for label, count in present_problems.items()
            )
            raise RuntimeError(f"Database integrity checks failed ({details}).")

        query = '''
            WITH proposition_bits AS (
                SELECT id, row_number() OVER (ORDER BY id) - 1 AS bit
                FROM "Propositions"
            ),
            facts AS (
                SELECT
                    kb.category,
                    bit_or(1::bigint << pb.bit::integer) AS known_mask,
                    bit_or(
                        CASE WHEN kb.value
                            THEN 1::bigint << pb.bit::integer
                            ELSE 0::bigint
                        END
                    ) AS value_mask
                FROM "KnowledgeBase" AS kb
                JOIN proposition_bits AS pb ON pb.id = kb.proposition
                GROUP BY kb.category
            )
            SELECT
                c.id::text,
                c.morphisms,
                c.objects,
                c."index",
                c.table,
                c.friendly_name,
                c.description,
                coalesce(f.known_mask, 0),
                coalesce(f.value_mask, 0)
            FROM "Categories" AS c
            LEFT JOIN facts AS f ON f.category = c.id
            ORDER BY c.morphisms, c.objects, c."index"
        '''

        exported_categories = 0
        with (output / "categories.ndjson").open("w", encoding="utf-8") as stream:
            with conn.cursor(name="smallcats_static_categories") as cursor:
                cursor.itersize = 1_000
                cursor.execute(query)
                for row in cursor:
                    table = row[4]
                    if not isinstance(table, (list, tuple)):
                        raise RuntimeError(
                            f"Category {row[0]} has an unexpected table value: {type(table).__name__}"
                        )
                    record = {
                        "id": row[0],
                        "morphisms": row[1],
                        "objects": row[2],
                        "sourceIndex": row[3],
                        "tableSha256": table_digest(table),
                        "friendlyName": row[5],
                        "description": row[6],
                        "knownMask": str(row[7]),
                        "valueMask": str(row[8]),
                    }
                    stream.write(f"{compact_json(record)}\n")
                    exported_categories += 1
                    if exported_categories % 25_000 == 0:
                        print(f"Exported {exported_categories:,} of {category_count:,} categories…")

        if exported_categories != category_count:
            raise RuntimeError(
                f"Expected {category_count} categories but exported {exported_categories}."
            )

        manifest = {
            "schemaVersion": 1,
            "exportedAt": datetime.now(timezone.utc).isoformat(),
            "categoryIdentity": "sha256(compact JSON multiplication table)",
            "categoryCount": category_count,
            "propositionCount": len(propositions),
            "relationCount": relation_count,
        }
        write_json(output / "export-manifest.json", manifest)
        return {
            "categories": category_count,
            "propositions": len(propositions),
            "relations": relation_count,
        }


def main() -> None:
    args = parse_args()
    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists() and not args.force:
        raise SystemExit(
            f"Output already exists: {output}\nUse --force only after preserving the prior export."
        )

    connection_string = database_url()
    if not connection_string:
        raise SystemExit("No database connection string was supplied.")

    temporary = Path(
        tempfile.mkdtemp(prefix=f".{output.name}-", dir=output.parent)
    )
    try:
        counts = export_database(connection_string, temporary)
        if output.exists():
            shutil.rmtree(output)
        temporary.replace(output)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise

    print(
        "Export complete: "
        f"{counts['categories']:,} categories, "
        f"{counts['propositions']:,} propositions, "
        f"{counts['relations']:,} facts."
    )
    print(f"Output: {output}")


if __name__ == "__main__":
    main()

"""Extract the 'Pricing Data' tab of the Seleqt order-entry workbook into JSON.

Usage: python scripts/extract_pricing.py "<path to .xlsm>"

The workbook prices a line with VLOOKUPs over 'Pricing Data'!A5:JH1082 using a column
number taken from row 4 (looked up by colour name in row 2). We keep the sheet as a sparse
list of rows (first-match VLOOKUP semantics are reproduced in src/engine/pricing.ts).
"""
import json
import sys
import warnings

import openpyxl

warnings.filterwarnings("ignore")

src = sys.argv[1]
ws = openpyxl.load_workbook(src, data_only=True)["Pricing Data"]

LAST_ROW = 421
LAST_COL = ws.max_column


def section(first, last):
    return [ws.cell(r, 1).value for r in range(first, last + 1)
            if ws.cell(r, 1).value not in (None, "End", "temp")]


# Colour name (row 2) -> price column number (row 4)
colour_cols = {}
for c in range(5, LAST_COL + 1):
    name, col = ws.cell(2, c).value, ws.cell(4, c).value
    if name is not None and isinstance(col, (int, float)):
        colour_cols[str(name)] = int(col)

rows = []
for r in range(5, LAST_ROW + 1):
    key = ws.cell(r, 1).value
    if key is None:
        continue
    cells = {}
    for c in range(2, LAST_COL + 1):
        v = ws.cell(r, c).value
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            cells[c] = v
    rows.append({"row": r, "key": key, "cells": cells})

out = {
    "rows": rows,
    "colourCols": colour_cols,
    "lists": {
        "item": section(2, 49)[1:],
        "back": section(50, 56)[1:],
        "thick": section(58, 73)[1:],
        "style": section(75, 198)[1:],
        "colour": section(199, 378)[1:],
    },
    # Style rows: col B base price, col C passes, col D profile edge add
    "styleMeta": {
        str(ws.cell(r, 1).value): {"passes": ws.cell(r, 3).value, "edgeAdd": ws.cell(r, 4).value}
        for r in range(76, 198) if ws.cell(r, 1).value
    },
}

dest = "src/data/pricing.json"
with open(dest, "w", encoding="utf8") as f:
    json.dump(out, f, indent=1, default=str)
print({k: len(v) for k, v in out["lists"].items()}, "rows:", len(rows), "colours:", len(colour_cols))

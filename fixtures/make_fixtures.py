"""Generate test PDFs: a digital statement spanning two pages, and a scanned invoice.

uv run --with reportlab --with pillow --with pypdfium2 python fixtures/make_fixtures.py fixtures
"""
import random
import sys
from pathlib import Path

from PIL import Image, ImageFilter
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
random.seed(7)

# 1. Digital: a two-page bank statement with a repeated header, plus a summary table.
c = canvas.Canvas(str(out / "statement.pdf"), pagesize=letter)
cols = [50, 130, 380, 470]
rows = []
bal = 1000.00
for i in range(1, 46):
    amt = round(random.uniform(-250, 400), 2)
    bal = round(bal + amt, 2)
    rows.append((f"03/{(i % 28) + 1:02d}/2026", f"Payment ref {1000 + i}" + (" ACME CORP" if i % 5 == 0 else ""), amt, bal))

def header(y):
    c.setFont("Helvetica-Bold", 10)
    for x, h in zip(cols, ["Date", "Description", "Amount", "Balance"]):
        c.drawString(x, y, h)

def rowline(y, r):
    c.setFont("Helvetica", 10)
    c.drawString(cols[0], y, r[0])
    c.drawString(cols[1], y, r[1])
    amt = f"({abs(r[2]):,.2f})" if r[2] < 0 else f"{r[2]:,.2f}"
    c.drawRightString(cols[2] + 60, y, amt)
    c.drawRightString(cols[3] + 70, y, f"{r[3]:,.2f}")

c.setFont("Helvetica-Bold", 16)
c.drawString(50, 740, "Riverbank Checking - March 2026")
c.setFont("Helvetica", 10)
c.drawString(50, 722, "Account 00012345 - statement period 03/01/2026 to 03/31/2026")
y = 690
header(y)
y -= 16
for r in rows[:30]:
    rowline(y, r)
    y -= 15
c.drawString(50, 40, "Page 1 of 2")
c.showPage()
y = 740
header(y)
y -= 16
for r in rows[30:]:
    rowline(y, r)
    y -= 15
y -= 30
c.setFont("Helvetica-Bold", 12)
c.drawString(50, y, "Summary")
y -= 18
summary = [("Opening balance", 1000.00), ("Deposits", sum(r[2] for r in rows if r[2] > 0)), ("Withdrawals", sum(r[2] for r in rows if r[2] < 0))]
c.setFont("Helvetica", 10)
for label, v in summary:
    c.drawString(50, y, label)
    c.drawRightString(300, y, f"{v:,.2f}")
    y -= 15
c.drawString(50, 40, "Page 2 of 2")
c.save()

# 2. Scanned: render an invoice to an image, degrade it, wrap as image-only PDF.
tmp = out / "_invoice_vector.pdf"
c = canvas.Canvas(str(tmp), pagesize=letter)
c.setFont("Helvetica-Bold", 18)
c.drawString(50, 730, "INVOICE #4471")
c.setFont("Helvetica", 11)
c.drawString(50, 710, "Northwind Supplies   Due: April 15, 2026")
items = [("Steel brackets", 120, 2.35), ("Hex bolts M8", 800, 0.12), ("Anchor plates", 40, 14.50), ("Freight", 1, 85.00)]
x = [50, 300, 380, 470]
y = 660
c.setFont("Helvetica-Bold", 11)
for xx, h in zip(x, ["Item", "Qty", "Unit", "Total"]):
    c.drawString(xx, y, h)
c.line(50, y - 5, 540, y - 5)
c.setFont("Helvetica", 11)
tot = 0
for name, q, u in items:
    y -= 20
    t = q * u
    tot += t
    c.drawString(x[0], y, name)
    c.drawRightString(x[1] + 30, y, str(q))
    c.drawRightString(x[2] + 50, y, f"{u:,.2f}")
    c.drawRightString(x[3] + 60, y, f"{t:,.2f}")
y -= 25
c.setFont("Helvetica-Bold", 11)
c.drawString(x[0], y, "Total")
c.drawRightString(x[3] + 60, y, f"{tot:,.2f}")
c.save()

import pypdfium2 as pdfium  # noqa: E402

img = pdfium.PdfDocument(str(tmp))[0].render(scale=200 / 72).to_pil().convert("L")
img = img.rotate(0.8, fillcolor=255, resample=Image.BICUBIC).filter(ImageFilter.GaussianBlur(0.6))
px = img.load()
w, h = img.size
for _ in range(w * h // 40):
    x, y = random.randrange(w), random.randrange(h)
    px[x, y] = max(0, min(255, px[x, y] + random.randint(-90, 90)))
img.save(str(out / "scanned-invoice.pdf"), resolution=200, quality=70)
tmp.unlink()

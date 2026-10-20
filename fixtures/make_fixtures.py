"""Generate the PDF test corpus. Each fixture targets one way real-world PDFs go wrong.

uv run --with reportlab --with pillow --with pypdfium2 --with numpy python fixtures/make_fixtures.py fixtures

Expectations for the golden test live in fixtures/manifest.json (hand-written,
kept next to this file). Regenerating is deterministic (fixed seeds).
"""

import io
import random
import sys
from pathlib import Path

import numpy as np
import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFilter
from reportlab.lib.pagesizes import landscape, letter, A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
FONTS = Path("/System/Library/Fonts/Supplemental")
pdfmetrics.registerFont(TTFont("ArialUni", str(FONTS / "Arial Unicode.ttf")))


def money(v: float, parens=True, comma_decimal=False) -> str:
    s = f"{abs(v):,.2f}"
    if comma_decimal:
        s = s.replace(",", "_").replace(".", ",").replace("_", ".")
    if v < 0:
        return f"({s})" if parens else f"-{s}"
    return s


# ---------------------------------------------------------------- statement
def statement():
    """Two-page bank statement: repeated header, page footers, summary table on p2."""
    random.seed(7)
    c = canvas.Canvas(str(out / "statement.pdf"), pagesize=letter)
    cols = [50, 130, 380, 470]
    rows, bal = [], 1000.00
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
        c.drawRightString(cols[2] + 60, y, money(r[2]))
        c.drawRightString(cols[3] + 70, y, money(r[3]))

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
        c.drawRightString(300, y, money(v, parens=False))
        y -= 15
    c.drawString(50, 40, "Page 2 of 2")
    c.save()


# ---------------------------------------------------------------- invoice (vector, for scans)
def invoice_vector(path: Path):
    c = canvas.Canvas(str(path), pagesize=letter)
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


def render(path: Path, dpi: int) -> Image.Image:
    return pdfium.PdfDocument(str(path))[0].render(scale=dpi / 72).to_pil().convert("L")


def noise(img: Image.Image, amount: int, seed: int) -> Image.Image:
    rng = np.random.default_rng(seed)
    a = np.asarray(img, dtype=np.int16)
    a = a + rng.normal(0, amount, a.shape).astype(np.int16)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def image_pdf(img: Image.Image, path: Path, dpi: int, quality: int):
    img.convert("RGB").save(str(path), resolution=dpi, quality=quality)


def scans():
    vec = out / "_invoice_vector.pdf"
    invoice_vector(vec)

    # Clean office scan: 200 dpi, slight skew, light noise.
    img = render(vec, 200).rotate(0.8, fillcolor=255, resample=Image.BICUBIC).filter(ImageFilter.GaussianBlur(0.6))
    image_pdf(noise(img, 18, 3), out / "scanned-invoice.pdf", 200, 70)

    # Bad fax-grade scan: 110 dpi, 2.5° skew, heavy noise, crushed JPEG.
    img = render(vec, 110).rotate(2.5, fillcolor=245, resample=Image.BICUBIC).filter(ImageFilter.GaussianBlur(0.9))
    img = noise(img, 45, 4).point(lambda p: 255 if p > 150 else int(p * 0.6))
    image_pdf(img, out / "scanned-bad.pdf", 110, 25)

    # Phone photo: perspective warp, uneven lighting, warm tint, on a desk.
    src = render(vec, 150).convert("RGB")
    w, h = src.size
    coeffs = _perspective_coeffs([(0, 0), (w, 0), (w, h), (0, h)], [(60, 40), (w - 20, 90), (w - 90, h - 30), (10, h - 80)])
    warped = src.transform((w, h), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=(92, 74, 58))
    shade = Image.linear_gradient("L").resize((w, h)).rotate(35, expand=False)
    warped = Image.composite(warped, Image.new("RGB", (w, h), (70, 60, 50)), shade.point(lambda p: 150 + p * 105 // 255))
    tint = Image.new("RGB", (w, h), (255, 236, 205))
    warped = Image.blend(warped, tint, 0.12).filter(ImageFilter.GaussianBlur(0.8))
    warped.save(str(out / "photo-invoice.pdf"), resolution=150, quality=60)

    # Scan whose hidden OCR text layer is garbage (broken font encoding).
    img = render(vec, 150)
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=70)
    c = canvas.Canvas(str(out / "broken-text-layer.pdf"), pagesize=letter)
    from reportlab.lib.utils import ImageReader

    c.drawImage(ImageReader(io.BytesIO(buf.getvalue())), 0, 0, width=letter[0], height=letter[1])
    t = c.beginText(50, 700)
    t.setTextRenderMode(3)  # invisible, like an OCR layer
    t.setFont("ArialUni", 11)
    rng = random.Random(9)
    for _ in range(30):
        t.textLine("".join(chr(0xE000 + rng.randrange(400)) if rng.random() > 0.15 else " " for _ in range(48)))
    c.drawText(t)
    c.save()
    vec.unlink()


def _perspective_coeffs(src, dst):
    m = []
    for (x, y), (u, v) in zip(dst, src):
        m.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        m.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    a = np.array(m, dtype=float)
    b = np.array(src, dtype=float).reshape(8)
    return np.linalg.solve(a, b).tolist()


# ---------------------------------------------------------------- ruled + wrapped
def ruled_wrapped():
    """Grid-lined table with wrapped multi-line description cells."""
    c = canvas.Canvas(str(out / "ruled-wrapped.pdf"), pagesize=letter)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, 740, "Change orders - Building C")
    rows = [
        ("CO-101", "Relocate electrical panel to north wall per revised drawing E-3, including new conduit runs", "4,250.00", "Approved"),
        ("CO-102", "Add two skylights", "7,800.00", "Pending"),
        ("CO-103", "Upgrade lobby flooring from vinyl to porcelain tile; owner-supplied grout", "12,410.50", "Approved"),
        ("CO-104", "Credit for deleted canopy", "(3,000.00)", "Approved"),
        ("CO-105", "Fire sprinkler head relocation at mezzanine, coordinate with HVAC duct reroute and ceiling grid", "2,975.25", "Rejected"),
    ]
    xs = [50, 120, 400, 490, 562]
    y = 715
    heights = []
    c.setFont("Helvetica", 9.5)
    wrapped = []
    for r in rows:
        lines = _wrap(r[1], 270, "Helvetica", 9.5)
        wrapped.append(lines)
        heights.append(max(1, len(lines)) * 12 + 8)
    c.setLineWidth(0.6)
    total_h = 20 + sum(heights)
    for x in xs:
        c.line(x, y, x, y - total_h)
    c.line(xs[0], y, xs[-1], y)
    c.setFont("Helvetica-Bold", 9.5)
    for x, h in zip(xs, ["No.", "Description", "Amount", "Status"]):
        c.drawString(x + 5, y - 14, h)
    y -= 20
    c.line(xs[0], y, xs[-1], y)
    c.setFont("Helvetica", 9.5)
    for r, lines, hgt in zip(rows, wrapped, heights):
        c.drawString(xs[0] + 5, y - 13, r[0])
        for i, ln in enumerate(lines):
            c.drawString(xs[1] + 5, y - 13 - i * 12, ln)
        c.drawRightString(xs[3] - 6, y - 13, r[2])
        c.drawString(xs[3] + 5, y - 13, r[3])
        y -= hgt
        c.line(xs[0], y, xs[-1], y)
    c.save()


def _wrap(text, width, font, size):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if pdfmetrics.stringWidth(trial, font, size) > width:
            lines.append(cur)
            cur = w
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


# ---------------------------------------------------------------- EU invoice
def eu_invoice():
    """Decimal commas, € suffix, DD.MM.YYYY dates, key-value block, A4."""
    c = canvas.Canvas(str(out / "eu-invoice.pdf"), pagesize=A4)
    W, H = A4
    c.setFont("Helvetica-Bold", 16)
    c.drawString(50, H - 70, "Rechnung")
    c.setFont("Helvetica", 10)
    kv = [("Rechnungsnummer", "RE-2026-0412"), ("Rechnungsdatum", "03.04.2026"), ("Kundennummer", "004711"), ("Fällig am", "17.04.2026")]
    y = H - 100
    for k, v in kv:
        c.drawString(50, y, k)
        c.drawString(170, y, v)
        y -= 14
    items = [("Beratung", "8,0", "Std.", 120.00), ("Lizenz Jahresabo", "1", "Stk.", 1490.00), ("Schulung vor Ort", "2,5", "Tage", 850.00), ("Reisekosten", "1", "pausch.", 312.40)]
    y -= 30
    xs = [50, 260, 320, 400, 545]
    c.setFont("Helvetica-Bold", 10)
    for x, h in zip(xs[:3], ["Position", "Menge", "Einheit"]):
        c.drawString(x, y, h)
    c.drawRightString(470, y, "Einzelpreis")
    c.drawRightString(545, y, "Gesamt")
    c.setFont("Helvetica", 10)
    net = 0.0
    for name, qty, unit, price in items:
        y -= 16
        q = float(qty.replace(",", "."))
        tot = q * price
        net += tot
        c.drawString(xs[0], y, name)
        c.drawRightString(300, y, qty)
        c.drawString(xs[2], y, unit)
        c.drawRightString(470, y, money(price, comma_decimal=True) + " €")
        c.drawRightString(545, y, money(tot, comma_decimal=True) + " €")
    y -= 26
    vat = round(net * 0.19, 2)
    for label, v in [("Nettobetrag", net), ("USt. 19 %", vat), ("Gesamtbetrag", net + vat)]:
        c.drawString(320, y, label)
        c.drawRightString(545, y, money(v, comma_decimal=True) + " €")
        y -= 15
    c.save()


# ---------------------------------------------------------------- financial report
def financial_report():
    """Landscape P&L: two-level header, sections, subtotals, %, dashes, footnotes."""
    c = canvas.Canvas(str(out / "financial-report.pdf"), pagesize=landscape(letter))
    W, H = landscape(letter)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(50, H - 55, "Consolidated statement of operations")
    c.setFont("Helvetica", 9)
    c.drawString(50, H - 70, "(in thousands of USD, except per-share data)")
    cols = [330, 400, 470, 540, 630, 700]
    y = H - 105
    c.setFont("Helvetica-Bold", 9.5)
    c.drawCentredString((cols[0] + cols[3]) / 2 + 20, y, "Three months ended")
    c.drawCentredString((cols[4] + cols[5]) / 2 + 20, y, "Change")
    c.line(cols[0] - 10, y - 4, cols[3] + 50, y - 4)
    y -= 16
    for x, h in zip(cols, ["Mar 31, 2026", "Dec 31, 2025", "Sep 30, 2025", "Jun 30, 2025", "QoQ %", "YoY %"]):
        c.drawRightString(x + 50, y, h)
    revenue = [("Subscription", [41210, 38904, 36120, 33980]), ("Professional services", [3105, 3420, 2980, 3002]), ("Hardware¹", [1220, 0, 0, 0])]
    costs = [("Cost of revenue", [-14102, -13350, -12406, -11920]), ("Research and development", [-9830, -9411, -9002, -8770]), ("Sales and marketing", [-11204, -10660, -10115, -9905]), ("General and administrative", [-4420, -4198, -4012, -3990])]

    def line(label, vals, bold=False):
        nonlocal y
        y -= 15
        c.setFont("Helvetica-Bold" if bold else "Helvetica", 9.5)
        c.drawString(60 if not bold else 50, y, label)
        for x, v in zip(cols, vals):
            c.drawRightString(x + 50, y, "—" if v == 0 else f"({abs(v):,})" if v < 0 else f"{v:,}")
        q = (vals[0] - vals[1]) / abs(vals[1]) * 100 if vals[1] else None
        yoy = (vals[0] - vals[3]) / abs(vals[3]) * 100 if vals[3] else None
        for x, p in zip(cols[4:], [q, yoy]):
            c.drawRightString(x + 50, y, "n/m" if p is None else f"{p:.1f}%")

    y -= 8
    c.setFont("Helvetica-Bold", 9.5)
    c.drawString(50, y - 15, "Revenue")
    y -= 15
    for l, v in revenue:
        line(l, v)
    rev_tot = [sum(v[i] for _, v in revenue) for i in range(4)]
    line("Total revenue", rev_tot, bold=True)
    y -= 8
    c.setFont("Helvetica-Bold", 9.5)
    c.drawString(50, y - 15, "Operating expenses")
    y -= 15
    for l, v in costs:
        line(l, v)
    cost_tot = [sum(v[i] for _, v in costs) for i in range(4)]
    line("Total operating expenses", cost_tot, bold=True)
    y -= 6
    line("Operating income", [a + b for a, b in zip(rev_tot, cost_tot)], bold=True)
    y -= 30
    c.setFont("Helvetica", 8)
    c.drawString(50, y, "¹ Hardware sales began in Q1 2026 following the Lumen acquisition.")
    c.save()


# ---------------------------------------------------------------- mixed document
def mixed():
    """Prose page, blank page, a table page, and a /Rotate 90 page with a table."""
    c = canvas.Canvas(str(out / "mixed-document.pdf"), pagesize=letter)
    c.setFont("Times-Roman", 12)
    t = c.beginText(72, 700)
    para = ("This quarterly letter summarises operating results and outlook. Readers should refer to the "
            "attached schedules for detail. Nothing on this page is tabular; a converter should find no "
            "tables here and should not invent any from ordinary paragraphs of text.")
    for ln in _wrap(para * 3, 460, "Times-Roman", 12):
        t.textLine(ln)
    c.drawText(t)
    c.showPage()
    c.showPage()  # blank
    c.setFont("Helvetica-Bold", 12)
    c.drawString(72, 700, "Headcount by office")
    data = [("Office", "Engineering", "Sales", "Total"), ("Austin", "84", "22", "106"), ("Dublin", "41", "18", "59"), ("Singapore", "12", "15", "27"), ("Total", "137", "55", "192")]
    y = 675
    for i, r in enumerate(data):
        c.setFont("Helvetica-Bold" if i in (0, len(data) - 1) else "Helvetica", 10)
        c.drawString(72, y, r[0])
        for x, v in zip([300, 380, 460], r[1:]):
            c.drawRightString(x, y, v)
        y -= 15
    c.showPage()
    # Landscape content on a portrait page, rotated by the /Rotate key.
    # Viewers turn the page 90° clockwise, so draw the content turned 90°
    # counter-clockwise: landscape coordinates (u, v) map to (W - v, u).
    # ReportLab swaps the media box when rotating, so ask for landscape to end
    # up with a portrait (612x792) box plus /Rotate 90, as scanners produce.
    c.setPageSize(landscape(letter))
    c.setPageRotation(90)
    c.saveState()
    c.translate(letter[0], 0)
    c.rotate(90)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(60, letter[0] - 80, "Inventory by warehouse")
    y = letter[0] - 105
    for i, r in enumerate([("SKU", "Reno", "Columbus", "Total"), ("A-100", "1,200", "800", "2,000"), ("A-200", "340", "1,020", "1,360"), ("B-310", "75", "0", "75")]):
        c.setFont("Helvetica-Bold" if i == 0 else "Helvetica", 10)
        c.drawString(60, y, r[0])
        for x, v in zip([300, 420, 540], r[1:]):
            c.drawRightString(x, y, v)
        y -= 15
    c.restoreState()
    c.save()


# ---------------------------------------------------------------- dense + wide
def dense_wide():
    """Landscape, 12 columns, 55 rows, 6.5pt: IDs with leading zeros, %, dates."""
    random.seed(11)
    c = canvas.Canvas(str(out / "dense-wide.pdf"), pagesize=landscape(letter))
    W, H = landscape(letter)
    heads = ["Store", "Region", "Opened", "Q1", "Q2", "Q3", "Q4", "FY", "Margin", "Staff", "Sq ft", "Rating"]
    xs = [30, 70, 125, 205, 260, 315, 370, 435, 490, 535, 590, 640]
    right = {3, 4, 5, 6, 7, 8, 9, 10, 11}
    c.setFont("Helvetica-Bold", 7)
    y = H - 40
    for i, (x, h) in enumerate(zip(xs, heads)):
        (c.drawRightString if i in right else c.drawString)(x + (40 if i in right else 0), y, h)
    c.setFont("Helvetica", 6.5)
    for n in range(55):
        y -= 9.6
        q = [random.randint(80, 900) * 1000 for _ in range(4)]
        vals = [f"{n + 7:05d}", random.choice(["West", "East", "Central", "South"]), f"{random.randint(2009, 2025)}-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}",
                *[f"{v:,}" for v in q], f"{sum(q):,}", f"{random.uniform(-4, 22):.1f}%", str(random.randint(8, 60)), f"{random.randint(9, 60) * 100:,}", f"{random.uniform(2.5, 5):.1f}"]
        for i, (x, v) in enumerate(zip(xs, vals)):
            (c.drawRightString if i in right else c.drawString)(x + (40 if i in right else 0), y, v)
    c.save()


# ---------------------------------------------------------------- side by side
def side_by_side():
    """Two independent tables next to each other on one page."""
    c = canvas.Canvas(str(out / "side-by-side.pdf"), pagesize=letter)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(50, 720, "Top customers")
    c.drawString(330, 720, "Top products")
    left = [("Customer", "Revenue"), ("Contoso", "182,400"), ("Fabrikam", "121,050"), ("Tailspin", "98,700"), ("Wingtip", "64,300")]
    rightt = [("Product", "Units"), ("Widget Pro", "8,120"), ("Widget Lite", "6,904"), ("Gizmo", "2,330"), ("Doohickey", "1,215")]
    y = 698
    for i, (a, b) in enumerate(zip(left, rightt)):
        c.setFont("Helvetica-Bold" if i == 0 else "Helvetica", 10)
        c.drawString(50, y, a[0])
        c.drawRightString(260, y, a[1])
        c.drawString(330, y, b[0])
        c.drawRightString(540, y, b[1])
        y -= 15
    c.save()


# ---------------------------------------------------------------- no header, ids
def no_header():
    """Headerless export: zero-padded IDs, mixed date formats, trailing-minus negatives."""
    c = canvas.Canvas(str(out / "no-header-ids.pdf"), pagesize=letter)
    rows = [("000123", "2026-01-04", "Widget refill", "12.50"), ("000124", "01/05/2026", "Adapter", "8.00"), ("000125", "Jan 6, 2026", "Return - adapter", "8.00-"), ("000126", "2026-01-07", "Cable 2m", "4.75"), ("000127", "2026-01-09", "Widget refill", "12.50")]
    y = 720
    c.setFont("Courier", 10)
    for r in rows:
        c.drawString(50, y, r[0])
        c.drawString(130, y, r[1])
        c.drawString(230, y, r[2])
        c.drawRightString(470, y, r[3])
        y -= 14
    c.save()


# ---------------------------------------------------------------- password
def protected():
    """Password-protected (user password 'pdfcells')."""
    c = canvas.Canvas(str(out / "protected.pdf"), pagesize=letter, encrypt="pdfcells")
    c.setFont("Helvetica", 11)
    y = 700
    for r in [("Item", "Qty"), ("Secret sauce", "3"), ("Hidden gem", "7")]:
        c.drawString(72, y, r[0])
        c.drawRightString(300, y, r[1])
        y -= 16
    c.save()


if __name__ == "__main__":
    out.mkdir(parents=True, exist_ok=True)
    for fn in [statement, scans, ruled_wrapped, eu_invoice, financial_report, mixed, dense_wide, side_by_side, no_header, protected]:
        fn()
        print("ok", fn.__name__)

import io

from pypdf import PdfWriter


def escape_pdf_text(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pdf(page_texts: list[str]) -> bytes:
    objects: list[bytes] = []
    page_count = len(page_texts)
    first_page_id = 4
    kids = " ".join(f"{first_page_id + 2 * i} 0 R" for i in range(page_count))
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {page_count} >>".encode())
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for index, text in enumerate(page_texts):
        content_id = first_page_id + 2 * index + 1
        page = (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>"
        )
        stream = page_stream(text)
        objects.append(page.encode())
        objects.append(
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream"
        )
    return serialize(objects)


def page_stream(text: str) -> bytes:
    if not text:
        return b""
    shown = " T* ".join(f"({escape_pdf_text(line)}) Tj" for line in text.split("\n"))
    return f"BT /F1 12 Tf 14 TL 72 720 Td {shown} ET".encode()


def serialize(objects: list[bytes]) -> bytes:
    body = b"%PDF-1.4\n"
    offsets: list[int] = []
    for number, content in enumerate(objects, start=1):
        offsets.append(len(body))
        body += f"{number} 0 obj\n".encode() + content + b"\nendobj\n"
    xref_start = len(body)
    body += f"xref\n0 {len(objects) + 1}\n".encode() + b"0000000000 65535 f \n"
    for offset in offsets:
        body += f"{offset:010d} 00000 n \n".encode()
    body += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_start}\n%%EOF\n"
    ).encode()
    return body


def build_blank_pdf(page_count: int) -> bytes:
    writer = PdfWriter()
    for _ in range(page_count):
        writer.add_blank_page(width=612, height=792)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()

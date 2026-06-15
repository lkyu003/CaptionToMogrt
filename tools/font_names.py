import argparse
import struct
from pathlib import Path


NAME_IDS = {
    1: "Family",
    2: "Subfamily",
    4: "Full name",
    6: "PostScript",
}


def u16(data, offset):
    return struct.unpack_from(">H", data, offset)[0]


def u32(data, offset):
    return struct.unpack_from(">I", data, offset)[0]


def decode_name(raw, platform_id, encoding_id):
    if platform_id in (0, 3):
        try:
            return raw.decode("utf-16-be").strip("\x00").strip()
        except UnicodeDecodeError:
            pass
    if platform_id == 1:
        try:
            return raw.decode("mac_roman").strip("\x00").strip()
        except UnicodeDecodeError:
            pass
    for encoding in ("utf-8", "utf-16-be", "latin-1"):
        try:
            return raw.decode(encoding).strip("\x00").strip()
        except UnicodeDecodeError:
            continue
    return ""


def table_offsets(font_data):
    sfnt_version = font_data[:4]
    if sfnt_version == b"ttcf":
        count = u32(font_data, 8)
        return [u32(font_data, 12 + i * 4) for i in range(count)]
    return [0]


def find_name_table(font_data, offset):
    num_tables = u16(font_data, offset + 4)
    table_dir = offset + 12
    for i in range(num_tables):
        record = table_dir + i * 16
        tag = font_data[record:record + 4]
        if tag == b"name":
            return u32(font_data, record + 8), u32(font_data, record + 12)
    return None, None


def extract_names(font_path):
    font_data = Path(font_path).read_bytes()
    results = []

    for face_index, font_offset in enumerate(table_offsets(font_data)):
        name_offset, _ = find_name_table(font_data, font_offset)
        if name_offset is None:
            continue

        count = u16(font_data, name_offset + 2)
        storage_offset = name_offset + u16(font_data, name_offset + 4)
        records = {}

        for i in range(count):
            rec = name_offset + 6 + i * 12
            platform_id = u16(font_data, rec)
            encoding_id = u16(font_data, rec + 2)
            language_id = u16(font_data, rec + 4)
            name_id = u16(font_data, rec + 6)
            length = u16(font_data, rec + 8)
            string_offset = u16(font_data, rec + 10)

            if name_id not in NAME_IDS:
                continue

            raw = font_data[storage_offset + string_offset:storage_offset + string_offset + length]
            value = decode_name(raw, platform_id, encoding_id)
            if not value:
                continue

            # Prefer Windows English, then any Windows record, then first seen.
            score = 0
            if platform_id == 3:
                score += 10
            if language_id in (0x0409, 0x0000):
                score += 5
            if name_id not in records or score > records[name_id][0]:
                records[name_id] = (score, value)

        results.append((face_index, {name_id: value for name_id, (_, value) in records.items()}))

    return results


def main():
    parser = argparse.ArgumentParser(description="Print font family/full/PostScript names from a TTF/OTF/TTC file.")
    parser.add_argument("font", help="Path to .ttf, .otf, or .ttc font file")
    args = parser.parse_args()

    for face_index, names in extract_names(args.font):
        if face_index:
            print(f"Face #{face_index}")
        for name_id in (1, 2, 4, 6):
            if name_id in names:
                print(f"{NAME_IDS[name_id]}: {names[name_id]}")


if __name__ == "__main__":
    main()

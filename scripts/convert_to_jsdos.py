#!/usr/bin/env python3
import argparse
import io
import os
import posixpath
import zipfile


# ----------------------------
# ZIP NORMALIZATION
# ----------------------------

def normalize_names(names):
    clean = [n.replace("\\", "/") for n in names if not n.endswith("/")]
    top_parts = {n.split("/", 1)[0] for n in clean if "/" in n}
    has_root_files = any("/" not in n for n in clean)

    root_prefix = None
    if len(top_parts) == 1 and not has_root_files:
        root_prefix = next(iter(top_parts))

    if root_prefix:
        trimmed = [
            n[len(root_prefix) + 1:] if n.startswith(root_prefix + "/") else n
            for n in clean
        ]
        return root_prefix, trimmed

    return None, clean


# ----------------------------
# METADATA PARSING
# ----------------------------

def extract_autoexec(conf_text):
    in_auto = False
    lines = []

    for raw in conf_text.splitlines():
        line = raw.strip()
        low = line.lower()

        if line.startswith("[") and line.endswith("]"):
            in_auto = (low == "[autoexec]")
            continue

        if not in_auto:
            continue

        if not line or low.startswith(("rem", "#")):
            continue

        if line.startswith("@"):
            line = line[1:].strip()

        if low in {"cls", "exit", "c:", "z:"}:
            continue

        lines.append(line)

    return lines


def extract_cd(lines):
    for line in lines:
        low = line.lower()
        if low.startswith("cd "):
            return normalize_cd_path(line.split(" ", 1)[1])
    return None


def extract_win(lines):
    for line in lines:
        if line.lower().startswith("win"):
            return line
    return None


def extract_setup_lines(lines):
    keep = []
    for line in lines:
        low = line.lower()
        if low.startswith(("imgmount", "path=", "set ")):
            keep.append(line)
    return keep


def normalize_cd_path(path):
    path = path.replace("C:\\", "")
    path = path.replace("/", "\\")
    return path.strip("\\")


# ----------------------------
# FALLBACKS
# ----------------------------

def choose_command(names):
    candidates = [
        n for n in names
        if n.lower().endswith((".exe", ".bat", ".com"))
    ]

    if not candidates:
        return None

    def score(n):
        low = n.lower()
        s = 0
        base = posixpath.basename(low)
        stem = os.path.splitext(base)[0]
        if low.endswith(".exe"):
            s += 30
        if low.endswith(".bat"):
            s += 10
        if low.endswith(".com"):
            s += 20
        if "/windows/" in low:
            s -= 100
        if base.startswith(("setup", "install", "config", "graphset", "uninst", "readme", "file_id")):
            s -= 120
        if base in {
            "graphset.exe",
            "setsound.exe",
            "sound.exe",
            "soundset.exe",
            "setupsnd.exe",
            "install.exe",
            "setup.exe",
            "config.exe",
            "uninstal.exe",
            "uninstall.exe",
            "dos4gw.exe",
            "pkunzip.exe",
            "lha.exe",
            "arj.exe"
        }:
            s -= 200
        if stem in {
            "go",
            "install",
            "setup",
            "config",
            "readme",
            "dosinst",
            "sndsetup",
            "setsound",
            "setblaster",
            "mouse",
            "keyb",
            "vga",
            "ega",
            "cga"
        }:
            s -= 120
        if base.startswith(("play", "run", "game")):
            s += 40
        return s

    return max(candidates, key=score)


def detect_workdir(names, command=None):
    # ----------------------------
    # 1. If command exists, use its folder
    # ----------------------------
    if command:
        base = posixpath.basename(command).lower()
        base = base.replace(".exe", "").replace(".bat", "").replace(".com", "")

        for n in names:
            low = n.lower()
            if base in posixpath.basename(low):
                if "/" in low:
                    return low.split("/", 1)[0]

    # ----------------------------
    # 2. PRIORITY: folders containing executables
    # ----------------------------
    exe_dirs = {}

    for n in names:
        if "/" not in n:
            continue

        low = n.lower()
        if low.endswith((".exe", ".bat", ".com")):
            d = n.split("/", 1)[0]
            exe_dirs[d] = exe_dirs.get(d, 0) + 1

    # 🚨 THIS FIXES APPS WINNING
    if exe_dirs:
        # prefer HEGAMES over APPS because APPS usually has junk installers
        if "hegames" in exe_dirs:
            return "HEGAMES"
        return max(exe_dirs, key=exe_dirs.get)

    return None


# ----------------------------
# DOSBOX CONF GENERATION
# ----------------------------

def make_conf(names, root_prefix, metadata_lines):
    autoexec = [
        "@echo off",
        "mount c .",
        "c:"
    ]

    if root_prefix:
        autoexec.append(f"cd {normalize_cd_path(root_prefix)}")


    # --- metadata ---
    cd_meta = extract_cd(metadata_lines) if metadata_lines else None
    win_cmd = extract_win(metadata_lines) if metadata_lines else None
    setup_lines = extract_setup_lines(metadata_lines) if metadata_lines else []

    # setup (path, imgmount, etc.)
    autoexec.extend(setup_lines)

    # working directory
    if cd_meta:
        autoexec.append(f"cd {cd_meta}")
    else:
        fallback_cmd = choose_command(names)
        wd = detect_workdir(names, fallback_cmd)
        if wd:
            autoexec.append(f"cd {wd}")

    cmd = choose_command(names)
    autoexec.append(cmd or "echo No game detected")

    return f"""[sdl]
fullscreen=false
output=opengl

[dosbox]
memsize=32

[cpu]
core=auto
cycles=max

[autoexec]
{chr(10).join(autoexec)}
"""


# ----------------------------
# CONVERT ZIP
# ----------------------------

def convert_zip(src, dst, force=False):
    if os.path.exists(dst) and not force:
        print(f"SKIP {os.path.basename(src)} (exists)")
        return

    with zipfile.ZipFile(src, "r") as zin:
        raw_names = zin.namelist()
        root_prefix, names = normalize_names(raw_names)

        metadata_lines = []

        for n in raw_names:
            if n.lower().endswith("dosbox.conf"):
                try:
                    text = zin.read(n).decode("utf-8", "ignore")
                    metadata_lines = extract_autoexec(text)
                    break
                except:
                    pass

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
            for info in zin.infolist():
                zout.writestr(info, zin.read(info.filename))

            conf = make_conf(names, root_prefix, metadata_lines)
            zout.writestr(".jsdos/dosbox.conf", conf)

    with open(dst, "wb") as f:
        f.write(buf.getvalue())

    print(f"OK  {os.path.basename(src)}")


# ----------------------------
# CLI
# ----------------------------

def main():
    ap = argparse.ArgumentParser(description="Convert .zip to .jsdos")
    ap.add_argument("--input", required=True)
    ap.add_argument("--output")
    ap.add_argument("--mode", choices=["dos"], default="dos")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    in_dir = os.path.abspath(args.input)
    out_dir = os.path.abspath(args.output or in_dir)
    os.makedirs(out_dir, exist_ok=True)

    for f in os.listdir(in_dir):
        name_lower = f.lower()

        if not name_lower.endswith(".zip"):
            continue

        if "metadata" in name_lower or name_lower.startswith("!"):
            print(f"SKIP {f} (metadata)")
            continue

        src = os.path.join(in_dir, f)
        dst = os.path.join(out_dir, f.replace(".zip", ".jsdos"))

        try:
            convert_zip(src, dst, force=args.force)
        except Exception as e:
            print(f"ERR {f}: {e}")


if __name__ == "__main__":
    main()

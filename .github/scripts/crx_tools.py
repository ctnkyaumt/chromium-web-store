#!/usr/bin/env python3
"""CRX3 packing and release helpers for this fork.

Implements the CRX3 container directly so no browser is needed on the runner.
Container layout:
    "Cr24" | uint32le(3) | uint32le(len(header)) | header | zip

Subcommands:
    id           print the extension id derived from a private key
    pack         build a signed .crx from a source directory
    bump         bump the last component of the version in a manifest
    updates-xml  (re)write the omaha update manifest for this fork
"""
import argparse
import base64
import hashlib
import io
import json
import os
import shutil
import struct
import sys
import tempfile
import zipfile

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

CRX_MAGIC = b"Cr24"
CRX_VERSION = 3
SIGNATURE_CONTEXT = b"CRX3 SignedData\x00"
# CrxFileHeader field numbers (chromium's crx3.proto)
FIELD_SHA256_WITH_RSA = 2
FIELD_SIGNED_HEADER_DATA = 10000


def _varint(value):
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def _len_delimited(field, data):
    return _varint(field << 3 | 2) + _varint(len(data)) + data


def load_private_key(pem_path):
    with open(pem_path, "rb") as f:
        return serialization.load_pem_private_key(f.read(), password=None)


def public_key_der(private_key):
    """SubjectPublicKeyInfo DER -- the same bytes manifest.json's `key` holds."""
    return private_key.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def extension_id(der):
    digest = hashlib.sha256(der).hexdigest()[:32]
    return "".join(chr(ord("a") + int(c, 16)) for c in digest)


def build_zip(src_dir, zip_path):
    """Deterministic archive: sorted paths, fixed timestamps."""
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(src_dir):
            dirs.sort()
            for name in sorted(files):
                abspath = os.path.join(root, name)
                relpath = os.path.relpath(abspath, src_dir).replace(os.sep, "/")
                info = zipfile.ZipInfo(relpath, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                with open(abspath, "rb") as f:
                    z.writestr(info, f.read())


def sign_crx(zip_bytes, private_key):
    der = public_key_der(private_key)
    # SignedData.crx_id is the raw 16-byte sha256 prefix, not the a-p encoded form
    signed_header_data = _len_delimited(1, hashlib.sha256(der).digest()[:16])

    payload = (
        SIGNATURE_CONTEXT
        + struct.pack("<I", len(signed_header_data))
        + signed_header_data
        + zip_bytes
    )
    signature = private_key.sign(payload, padding.PKCS1v15(), hashes.SHA256())

    proof = _len_delimited(1, der) + _len_delimited(2, signature)
    header = _len_delimited(FIELD_SHA256_WITH_RSA, proof) + _len_delimited(
        FIELD_SIGNED_HEADER_DATA, signed_header_data
    )
    return (
        CRX_MAGIC
        + struct.pack("<I", CRX_VERSION)
        + struct.pack("<I", len(header))
        + header
        + zip_bytes
    )


def patch_manifest(manifest_path, der, update_url, version=None):
    """Pin the packed extension to our own key so the crx installs and updates."""
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    manifest["key"] = base64.b64encode(der).decode("ascii")
    if update_url:
        manifest["update_url"] = update_url
    if version:
        manifest["version"] = version
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=4, ensure_ascii=False)
    return manifest["version"]


def read_crx(raw):
    """Return (zip_bytes, manifest) from CRX2 or CRX3 bytes."""
    if raw[:4] != CRX_MAGIC:
        raise SystemExit("not a crx file (bad magic)")
    version = struct.unpack("<I", raw[4:8])[0]
    if version == 3:
        header_len = struct.unpack("<I", raw[8:12])[0]
        zip_bytes = raw[12 + header_len :]
    elif version == 2:
        key_len, sig_len = struct.unpack("<II", raw[8:16])
        zip_bytes = raw[16 + key_len + sig_len :]
    else:
        raise SystemExit("unsupported crx version {}".format(version))
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        manifest = json.loads(z.read("manifest.json").decode("utf-8"))
    return zip_bytes, manifest


def bump_last(version):
    parts = [int(p) for p in version.split(".")]
    while len(parts) < 4:
        parts.append(0)
    parts[3] += 1
    return ".".join(str(p) for p in parts[:4])


def resolve_published_version(state, digest, source_version):
    """Decide the version to publish for a dropped-in crx.

    The version inside the crx manifest is the primary signal. When the bytes
    change but that version does not -- a rebuild, or a replacement that forgot
    to bump -- the last component is incremented so clients still see an update.
    """
    if state.get("sha256") == digest:
        return state.get("version", source_version), "unchanged"
    if state.get("source_version") != source_version:
        return source_version, "new source version"
    return bump_last(state.get("version", source_version)), "same version, new bytes"


def cmd_pack(args):
    private_key = load_private_key(args.key)
    der = public_key_der(private_key)
    workdir = tempfile.mkdtemp(prefix="crx-")
    try:
        staged = os.path.join(workdir, "src")
        shutil.copytree(args.src, staged)
        version = patch_manifest(
            os.path.join(staged, "manifest.json"), der, args.update_url
        )
        zip_path = os.path.join(workdir, "ext.zip")
        build_zip(staged, zip_path)
        with open(zip_path, "rb") as f:
            crx = sign_crx(f.read(), private_key)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "wb") as f:
        f.write(crx)
    emit(crx_id=extension_id(der), version=version, crx_path=args.output)


def cmd_repack(args):
    """Re-sign a third party crx so it points at an update manifest we control."""
    private_key = load_private_key(args.key)
    der = public_key_der(private_key)

    with open(args.input, "rb") as f:
        raw = f.read()
    digest = hashlib.sha256(raw).hexdigest()
    zip_bytes, manifest = read_crx(raw)
    source_version = manifest["version"]

    state = {}
    if args.state and os.path.exists(args.state):
        with open(args.state, "r", encoding="utf-8") as f:
            state = json.load(f)
    version, reason = resolve_published_version(state, digest, source_version)

    workdir = tempfile.mkdtemp(prefix="crx-repack-")
    try:
        staged = os.path.join(workdir, "src")
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
            z.extractall(staged)
        patch_manifest(
            os.path.join(staged, "manifest.json"), der, args.update_url, version
        )
        repacked_zip = os.path.join(workdir, "ext.zip")
        build_zip(staged, repacked_zip)
        with open(repacked_zip, "rb") as f:
            crx = sign_crx(f.read(), private_key)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "wb") as f:
        f.write(crx)

    if args.state:
        os.makedirs(os.path.dirname(os.path.abspath(args.state)), exist_ok=True)
        with open(args.state, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "name": manifest.get("name", ""),
                    "sha256": digest,
                    "source_version": source_version,
                    "version": version,
                },
                f,
                indent=4,
                ensure_ascii=False,
            )
            f.write("\n")

    emit(
        crx_id=extension_id(der),
        version=version,
        source_version=source_version,
        reason=reason,
    )


def cmd_id(args):
    der = public_key_der(load_private_key(args.key))
    emit(crx_id=extension_id(der))


def cmd_bump(args):
    with open(args.manifest, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    if getattr(args, "version", None):
        old, new = manifest["version"], args.version
    else:
        parts = [int(p) for p in manifest["version"].split(".")]
        # chrome compares at most 4 components; pad then bump the last one
        while len(parts) < 4:
            parts.append(0)
        parts[3] += 1
        old, new = manifest["version"], ".".join(str(p) for p in parts[:4])
    manifest["version"] = new
    with open(args.manifest, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=4, ensure_ascii=False)
    emit(old_version=old, version=new)


def cmd_updates_xml(args):
    xml = (
        "<?xml version='1.0' encoding='UTF-8'?>\n"
        "<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>\n"
        "  <app appid='{appid}'>\n"
        "    <updatecheck codebase='{codebase}' version='{version}' status='ok' />\n"
        "  </app>\n"
        "</gupdate>\n"
    ).format(appid=args.appid, codebase=args.codebase, version=args.version)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(xml)
    emit(updates_xml=args.output)


def emit(**values):
    """Print key=value and append to $GITHUB_OUTPUT when running in Actions."""
    lines = ["{}={}".format(k, v) for k, v in values.items()]
    print("\n".join(lines))
    gh_output = os.environ.get("GITHUB_OUTPUT")
    if gh_output:
        with open(gh_output, "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("pack", help="build a signed .crx")
    p.add_argument("--src", default="src")
    p.add_argument("--output", required=True)
    p.add_argument("--key", required=True, help="RSA private key in PEM format")
    p.add_argument("--update-url", help="overrides manifest.json update_url")
    p.set_defaults(func=cmd_pack)

    p = sub.add_parser("repack", help="re-sign an existing crx under our key")
    p.add_argument("--input", required=True, help="source .crx to re-sign")
    p.add_argument("--output", required=True)
    p.add_argument("--key", required=True, help="RSA private key in PEM format")
    p.add_argument("--update-url", required=True)
    p.add_argument("--state", help="json file tracking the last published build")
    p.set_defaults(func=cmd_repack)

    p = sub.add_parser("id", help="print the extension id for a key")
    p.add_argument("--key", required=True)
    p.set_defaults(func=cmd_id)

    p = sub.add_parser("bump", help="bump the 4th version component")
    p.add_argument("--manifest", default="src/manifest.json")
    p.add_argument("--version", help="set explicit version instead of bumping")
    p.set_defaults(func=cmd_bump)

    p = sub.add_parser("updates-xml", help="write the omaha update manifest")
    p.add_argument("--appid", required=True)
    p.add_argument("--version", required=True)
    p.add_argument("--codebase", required=True)
    p.add_argument("--output", default="updates.xml")
    p.set_defaults(func=cmd_updates_xml)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    sys.exit(main())

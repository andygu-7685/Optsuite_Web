import argparse
import sys
from pathlib import Path

from . import constants as C

def parse_args(argv=None):
  parser = argparse.ArgumentParser(prog="usaf_registration")
  parser.add_argument("paths", nargs="+", help="image files and/or folders")
  parser.add_argument("--recursive", action="store_true", help="recurse into folders")
  return parser.parse_args(argv)

def collect_images(paths, recursive):
  images = []
  for raw in paths:
    path = Path(raw)
    if path.is_dir():
      images.extend(C.get_image_paths(path, recursive))
    elif path.is_file():
      images.append(str(path))
    else:
      print(f"warning: not found, skipping: {raw}", file=sys.stderr)
  return images


def main(argv=None):
  args = parse_args(argv)

  images = collect_images(args.paths, args.recursive)
  if not images:
    print("no images found", file=sys.stderr)
    return 2

  print(f"{len(images)} image(s):")
  for image_path in images:
    print(f"  {image_path}")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
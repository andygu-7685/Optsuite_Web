import argparse

from . import constants as C


def parse_args(argv=None):
  parser = argparse.ArgumentParser(prog="usaf_registration")
  parser.add_argument("paths", nargs="+", help="image files and/or folders")
  return parser.parse_args(argv)


def main(argv=None):
  args = parse_args(argv)
  print("paths:", args.paths)
  print("default transform:", C.PT_TRANSFORM)
  print("log path:", C.LOG_PATH)
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
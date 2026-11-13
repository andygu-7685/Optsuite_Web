import re


OVERLAY_STYLES = {
    "classic": {
        "line_color": (0, 230, 255), "line_width": 2,
        "label_color": (0, 230, 255), "label_width": 2,
    },
    "cyan_white": {
        "line_color": (255, 255, 0), "line_width": 3,
        "label_color": (255, 255, 255), "label_width": 2,
    },
    "magenta_yellow": {
        "line_color": (255, 0, 255), "line_width": 4,
        "label_color": (0, 230, 255), "label_width": 3,
    },
    "green_white": {
        "line_color": (80, 255, 80), "line_width": 2,
        "label_color": (255, 255, 255), "label_width": 2,
    },
}

CUSTOM_OVERLAY_STYLE = re.compile(r"custom:#([0-9a-fA-F]{6}):([1-9]|1[0-9]|20)")


def resolve_overlay_style(name: str) -> dict:
    if name in OVERLAY_STYLES:
        return OVERLAY_STYLES[name]
    match = CUSTOM_OVERLAY_STYLE.fullmatch(name)
    if not match:
        raise ValueError("Unknown overlay style")
    rgb = match.group(1)
    color = tuple(int(rgb[index:index + 2], 16) for index in (4, 2, 0))
    return {"line_color": color, "line_width": int(match.group(2)), "label_color": color, "label_width": 2}

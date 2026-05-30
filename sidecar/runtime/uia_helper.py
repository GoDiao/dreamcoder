"""
uia_helper.py — UIA Tree Computer Use agent for Windows.

Single-file Python helper that exposes Windows UI Automation tree traversal
and element interaction via CLI commands. Called by the Electron sidecar
through `callPythonHelper(command, payload, 'uia_helper')`.

CLI interface (same pattern as win_helper.py):
    python uia_helper.py <command> --payload '{...}'

Commands:
    get_state          — Get desktop UIA tree (TOON format text + selector map)
    click_by_id        — Click an element by its selector ID
    double_click_by_id — Double-click an element by its selector ID
    type_by_id         — Type text into an element by its selector ID
    scroll_by_id       — Scroll an element by its selector ID
    screenshot         — Capture screenshot (reuses mss like win_helper)
"""

import argparse
import base64
import ctypes
import ctypes.wintypes
import json
import sys
from io import BytesIO
from time import perf_counter

# ---------------------------------------------------------------------------
# Minimal comtypes UIA COM interface definitions
# ---------------------------------------------------------------------------
# We define only the interfaces and methods we actually use, at their correct
# vtable indices. This avoids depending on a pre-generated UIAutomationClient
# module while still getting correct COM dispatch via comtypes.
# ---------------------------------------------------------------------------

import comtypes
import comtypes.client
from comtypes import GUID, IUnknown, BSTR
from ctypes import POINTER, c_int, c_double, c_bool, c_void_p, byref

# COM RECT structure used by UIA BoundingRectangle
class COMRECT(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


# ---------- IUIAutomationCacheRequest ----------
class IUIAutomationCacheRequest(IUnknown):
    _iid_ = GUID('{B322B023-3AD2-4671-B358-2C62AB58C489}')
    _methods_ = [
        (3, 'AddPattern',  ([], c_int, 'patternId')),
        (4, 'AddProperty', ([], c_int, 'propertyId')),
        (5, 'put_TreeScope', ([], c_int, 'scope')),
        (7, 'Clone', ['out,retval'], POINTER(POINTER(IUIAutomationCacheRequest))),
    ]


# ---------- IUIAutomationCondition ----------
class IUIAutomationCondition(IUnknown):
    _iid_ = GUID('{352FFBA8-0973-437C-A61F-F64CAFD81DF9}')
    _methods_ = []  # no methods beyond IUnknown


# ---------- IUIAutomationElement ----------
# Vtable layout (IUnknown 0-2, then element methods):
#   3:SetFocus 5:Name 6:ControlType 7:LocalizedControlType
#   8:AutomationId 9:ClassName 10:HelpText 11:Culture
#   12:ControlType 13:LocalizedControlType 14:AcceleratorKey 15:AccessKey
#   16:HasKeyboardFocus 17:IsKeyboardFocusable 18:IsEnabled 19:IsPassword
#   20:IsOffscreen 21:IsContentElement 22:IsControlElement 23:LabeledBy
#   24:Culture 25-27:layout props 28:IsPeripheral 30:ProviderOptions
#   ... (Current* methods continue)
#   75:CachedProviderOptions 76:CachedName 77:AcceleratorKey
#   78:CachedControlType 79:CachedLocalizedControlType 80:CachedAutomationId
#   81:CachedClassName 82:CachedHelpText 83:CachedCulture
#   84:CachedControlType 85:CachedLocalizedControlType
#   86:CachedAcceleratorKey 87:CachedAccessKey
#   88:CachedHasKeyboardFocus 89:CachedIsKeyboardFocusable
#   90:CachedIsEnabled 91:CachedIsPassword 92:CachedIsOffscreen
#   93:CachedIsControlElement 94:CachedBoundingRectangle
#   ...
#   113:GetCachedPattern 114:FindFirst 115:FindAll
#   116:GetUpdatedCache 117:BuildUpdatedCache
class IUIAutomationElement(IUnknown):
    _iid_ = GUID('{D22108AA-8AC5-49A5-834B-99046913A269}')
    _methods_ = [
        # IUnknown: QI=0, AddRef=1, Release=2
        # --- Current properties ---
        (3, 'SetFocus', []),
        (5, 'CurrentName',        ['propget', 'out,retval'], POINTER(BSTR)),
        (12, 'CurrentControlType',  ['propget', 'out,retval'], POINTER(c_int)),
        (13, 'CurrentLocalizedControlType', ['propget', 'out,retval'], POINTER(BSTR)),
        (16, 'CurrentHasKeyboardFocus',    ['propget', 'out,retval'], POINTER(c_bool)),
        (17, 'CurrentIsKeyboardFocusable', ['propget', 'out,retval'], POINTER(c_bool)),
        (18, 'CurrentIsEnabled',   ['propget', 'out,retval'], POINTER(c_bool)),
        (20, 'CurrentIsOffscreen', ['propget', 'out,retval'], POINTER(c_bool)),
        (22, 'CurrentIsControlElement', ['propget', 'out,retval'], POINTER(c_bool)),
        (28, 'CurrentBoundingRectangle',    ['propget', 'out,retval'], POINTER(COMRECT)),
        (30, 'CurrentLocalizedControlType2', ['propget', 'out,retval'], POINTER(BSTR)),
        (31, 'GetCurrentPattern',  ([], c_int, 'patternId', 'out,retval'), POINTER(IUnknown)),
        # --- Cached properties (indices 75+) ---
        (76, 'CachedName',         ['propget', 'out,retval'], POINTER(BSTR)),
        (78, 'CachedControlType',  ['propget', 'out,retval'], POINTER(c_int)),
        (79, 'CachedLocalizedControlType', ['propget', 'out,retval'], POINTER(BSTR)),
        (84, 'CachedBoundingRectangle',    ['propget', 'out,retval'], POINTER(COMRECT)),
        (88, 'CachedHasKeyboardFocus',    ['propget', 'out,retval'], POINTER(c_bool)),
        (89, 'CachedIsKeyboardFocusable', ['propget', 'out,retval'], POINTER(c_bool)),
        (90, 'CachedIsEnabled',    ['propget', 'out,retval'], POINTER(c_bool)),
        (92, 'CachedIsOffscreen',  ['propget', 'out,retval'], POINTER(c_bool)),
        (93, 'CachedIsControlElement', ['propget', 'out,retval'], POINTER(c_bool)),
        (113, 'GetCachedPattern',  ([], c_int, 'patternId', 'out,retval'), POINTER(IUnknown)),
        # --- Tree operations ---
        (114, 'FindFirst',
         ([], c_int, 'scope'),
         ([], POINTER(IUIAutomationCondition), 'condition'),
         ['out,retval'], POINTER(POINTER(IUIAutomationElement))),
        (115, 'FindAll',
         ([], c_int, 'scope'),
         ([], POINTER(IUIAutomationCondition), 'condition'),
         ['out,retval'], POINTER(POINTER(IUIAutomationElementArray))),
        (117, 'BuildUpdatedCache',
         ([], POINTER(IUIAutomationCacheRequest), 'cacheRequest'),
         ['out,retval'], POINTER(POINTER(IUIAutomationElement))),
    ]


# ---------- IUIAutomationElementArray ----------
class IUIAutomationElementArray(IUnknown):
    _iid_ = GUID('{14314595-B4BC-4055-96F2-239DEA3D7AB1}')
    _methods_ = [
        (3, 'Length', ['propget', 'out,retval'], POINTER(c_int)),
        (4, 'GetElement', ([], c_int, 'index', 'out,retval'), POINTER(IUIAutomationElement)),
    ]


# ---------- Pattern interfaces ----------
class IUIAutomationInvokePattern(IUnknown):
    _iid_ = GUID('{FB377FBE-8EA6-46D5-9C73-6499642D3059}')
    _methods_ = [
        (3, 'Invoke', []),
    ]

class IUIAutomationValuePattern(IUnknown):
    _iid_ = GUID('{A94CD8B1-0844-4CD5-9D72-8B2F2D47E57B}')
    _methods_ = [
        (3, 'put_Value', ([], BSTR, 'value')),
        (4, 'CurrentIsReadOnly', ['propget', 'out,retval'], POINTER(c_bool)),
    ]

class IUIAutomationScrollPattern(IUnknown):
    _iid_ = GUID('{88F4D42A-E881-459D-A77C-73BBBB7E02DC}')
    _methods_ = [
        (3, 'SetScrollPercent', ([], c_double, 'horizontalPercent'),
                                 ([], c_double, 'verticalPercent')),
        (4, 'CurrentHorizontalScrollPercent', ['propget', 'out,retval'], POINTER(c_double)),
        (5, 'CurrentVerticalScrollPercent',   ['propget', 'out,retval'], POINTER(c_double)),
        (9, 'CurrentHorizontallyScrollable',  ['propget', 'out,retval'], POINTER(c_bool)),
        (10, 'CurrentVerticallyScrollable',   ['propget', 'out,retval'], POINTER(c_bool)),
        (12, 'Scroll', ([], c_int, 'horizontalAmount'),
                        ([], c_int, 'verticalAmount')),
    ]

class IUIAutomationTogglePattern(IUnknown):
    _iid_ = GUID('{94CF8058-9B8D-4AB9-8BFD-4CD0A33C8CB7}')
    _methods_ = [
        (3, 'CurrentToggleState', ['propget', 'out,retval'], POINTER(c_int)),
        (4, 'Toggle', []),
    ]


# ---------- IUIAutomationTreeWalker ----------
class IUIAutomationTreeWalker(IUnknown):
    _iid_ = GUID('{4042C624-389C-4AFC-A630-9D8C931E6531}')
    _methods_ = [
        (3, 'GetParentElement',
         ([], POINTER(IUIAutomationElement), 'element'),
         ['out,retval'], POINTER(POINTER(IUIAutomationElement))),
        (4, 'GetFirstChildElement',
         ([], POINTER(IUIAutomationElement), 'element'),
         ['out,retval'], POINTER(POINTER(IUIAutomationElement))),
        (5, 'GetLastChildElement',
         ([], POINTER(IUIAutomationElement), 'element'),
         ['out,retval'], POINTER(POINTER(IUIAutomationElement))),
        (6, 'GetNextSiblingElement',
         ([], POINTER(IUIAutomationElement), 'element'),
         ['out,retval'], POINTER(POINTER(IUIAutomationElement))),
        (7, 'GetPreviousSiblingElement',
         ([], POINTER(IUIAutomationElement), 'element'),
         ['out,retval'], POINTER(POINTER(IUIAutomationElement))),
        (8, 'NormalizeElement',
         ([], POINTER(IUIAutomationElement), 'element'),
         ['out,retval'], POINTER(POINTER(IUIAutomationElement))),
        (9, 'get_Condition', ['out,retval'], POINTER(POINTER(IUIAutomationCondition))),
    ]

# ---------- IUIAutomation (root factory) ----------
class IUIAutomation(IUnknown):
    _iid_ = GUID('{30CBE57D-D9D0-452A-AB13-7AC5AC4825EE}')
    _methods_ = [
        # IUnknown: QI=0, AddRef=1, Release=2
        (3, 'CompareElements',
         ([], POINTER(IUIAutomationElement), 'el1'),
         ([], POINTER(IUIAutomationElement), 'el2'),
         ['out,retval'], POINTER(c_bool)),
        (4, 'CompareRuntimeIds',
         ([], POINTER(c_int), 'runtimeId1'),
         ([], POINTER(c_int), 'runtimeId2'),
         ['out,retval'], POINTER(c_bool)),
        (5, 'GetRootElement', ['out,retval'], POINTER(POINTER(IUIAutomationElement))),
        (6, 'ElementFromHandle',
         ([], ctypes.wintypes.HWND, 'hwnd'),
         ['out,retval'], POINTER(POINTER(IUIAutomationElement))),
        (7, 'ElementFromHandleBuildCache',
         ([], ctypes.wintypes.HWND, 'hwnd'),
         ([], POINTER(IUIAutomationCacheRequest), 'cacheRequest'),
         ['out,retval'], POINTER(POINTER(IUIAutomationElement))),
        (10, 'CreatePropertyCondition',
         ([], c_int, 'propertyId'),
         ([], c_void_p, 'value'),
         ['out,retval'], POINTER(POINTER(IUIAutomationCondition))),
        (11, 'CreatePropertyConditionEx',
         ([], c_int, 'propertyId'),
         ([], c_void_p, 'value'),
         ([], c_int, 'flags'),
         ['out,retval'], POINTER(POINTER(IUIAutomationCondition))),
        (14, 'CreateAndCondition',
         ([], POINTER(IUIAutomationCondition), 'condition1'),
         ([], POINTER(IUIAutomationCondition), 'condition2'),
         ['out,retval'], POINTER(POINTER(IUIAutomationCondition))),
        (15, 'CreateAndConditionFromArray',
         ([], POINTER(IUnknown), 'conditions'),
         ['out,retval'], POINTER(POINTER(IUIAutomationCondition))),
        (16, 'CreateOrCondition',
         ([], POINTER(IUIAutomationCondition), 'condition1'),
         ([], POINTER(IUIAutomationCondition), 'condition2'),
         ['out,retval'], POINTER(POINTER(IUIAutomationCondition))),
        (18, 'CreateNotCondition',
         ([], POINTER(IUIAutomationCondition), 'condition'),
         ['out,retval'], POINTER(POINTER(IUIAutomationCondition))),
        (20, 'CreateTreeWalker',
         ([], POINTER(IUIAutomationCondition), 'condition'),
         ['out,retval'], POINTER(POINTER(IUIAutomationTreeWalker))),
        (21, 'get_RawViewWalker', ['out,retval'], POINTER(POINTER(IUIAutomationTreeWalker))),
        (22, 'get_ControlViewWalker', ['out,retval'], POINTER(POINTER(IUIAutomationTreeWalker))),
        (23, 'get_ContentViewWalker', ['out,retval'], POINTER(POINTER(IUIAutomationTreeWalker))),
        (24, 'CreateCacheRequest', ['out,retval'], POINTER(POINTER(IUIAutomationCacheRequest))),
    ]


# ---------------------------------------------------------------------------
# UIA object singleton (created once per subprocess)
# ---------------------------------------------------------------------------

_uia = None

def _get_uia():
    global _uia
    if _uia is None:
        _uia = comtypes.client.CreateObject(
            '{FF48DBA4-60EF-4201-AA87-54103EEF594E}',  # CUIAutomation CLSID
            interface=IUIAutomation,
        )
    return _uia


# ---------------------------------------------------------------------------
# Control type constants and names
# ---------------------------------------------------------------------------

CONTROL_TYPE_NAMES = {
    50000: "Button", 50001: "Calendar", 50002: "CheckBox",
    50003: "ComboBox", 50004: "Edit", 50005: "Hyperlink",
    50006: "Image", 50007: "ListItem", 50008: "List",
    50009: "Menu", 50010: "MenuBar", 50011: "MenuItem",
    50012: "ProgressBar", 50013: "RadioButton", 50014: "ScrollBar",
    50015: "Slider", 50016: "Spinner", 50017: "StatusBar",
    50018: "Tab", 50019: "TabItem", 50020: "Text",
    50021: "ToolBar", 50022: "ToolTip", 50023: "Tree",
    50024: "TreeItem", 50025: "Custom", 50026: "Group",
    50027: "Thumb", 50028: "DataGrid", 50029: "DataItem",
    50030: "Document", 50031: "SplitButton", 50032: "Window",
    50033: "Pane", 50034: "Header", 50035: "HeaderItem",
    50036: "Table", 50037: "TitleBar", 50038: "Separator",
    50039: "SemanticZoom", 50040: "AppBar",
}

# Interactive control types (whitelist for get_state)
INTERACTIVE_TYPES = {
    50000,  # Button
    50002,  # CheckBox
    50003,  # ComboBox
    50004,  # Edit
    50005,  # Hyperlink
    50007,  # ListItem
    50011,  # MenuItem
    50013,  # RadioButton
    50015,  # Slider
    50016,  # Spinner
    50018,  # Tab
    50019,  # TabItem
    50024,  # TreeItem
    50029,  # DataItem
    50030,  # Document
    50031,  # SplitButton
    50035,  # HeaderItem
}

# UIA Pattern IDs
PATTERN_INVOKE    = 10000
PATTERN_VALUE     = 10002
PATTERN_SCROLL    = 10004
PATTERN_TOGGLE    = 10015
PATTERN_EXPAND    = 10005

# ScrollAmount constants
SCROLL_LARGE_DECREMENT = 0
SCROLL_SMALL_DECREMENT = 1
SCROLL_NO_AMOUNT       = 2
SCROLL_LARGE_INCREMENT = 3
SCROLL_SMALL_INCREMENT = 4

SCROLL_AMOUNT_MAP = {
    "large_decrement": SCROLL_LARGE_DECREMENT,
    "small_decrement": SCROLL_SMALL_DECREMENT,
    "large_increment": SCROLL_LARGE_INCREMENT,
    "small_increment": SCROLL_SMALL_INCREMENT,
    "up":    SCROLL_LARGE_DECREMENT,
    "down":  SCROLL_LARGE_INCREMENT,
    "left":  SCROLL_LARGE_DECREMENT,
    "right": SCROLL_LARGE_INCREMENT,
}

# Property IDs
PROP_NAME               = 30005
PROP_CONTROL_TYPE       = 30003
PROP_BOUNDING_RECT      = 30001
PROP_IS_ENABLED         = 30010
PROP_IS_OFFSCREEN       = 30022
PROP_IS_CONTROL_ELEMENT = 30016
PROP_IS_KB_FOCUSABLE    = 30009
PROP_HAS_KB_FOCUS       = 30008

# TreeScope
SCOPE_ELEMENT    = 1
SCOPE_CHILDREN   = 2
SCOPE_DESCENDANTS = 4
SCOPE_SUBTREE    = 7


# ---------------------------------------------------------------------------
# SelectorMap: index ↔ IUIAutomationElement
# ---------------------------------------------------------------------------

_selector_map: list[tuple[dict, 'IUIAutomationElement']] = []


def _clear_selector_map():
    global _selector_map
    _selector_map = []


def _add_to_selector_map(node_dict, element):
    global _selector_map
    idx = len(_selector_map)
    _selector_map.append((node_dict, element))
    return idx


# ---------------------------------------------------------------------------
# JSON output helpers (same as win_helper.py)
# ---------------------------------------------------------------------------

def json_output(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, default=str))
    sys.stdout.write("\n")
    sys.stdout.flush()


def error_output(message: str, code: str = "runtime_error") -> None:
    json_output({"ok": False, "error": {"code": code, "message": message}})


# ---------------------------------------------------------------------------
# UIA element property helpers (safe access for potentially dead elements)
# ---------------------------------------------------------------------------

def _safe_name(element) -> str:
    try:
        return element.CurrentName or ""
    except Exception:
        return ""


def _safe_cached_name(element) -> str:
    try:
        return element.CachedName or ""
    except Exception:
        return ""


def _safe_rect(element) -> tuple[int, int, int, int]:
    try:
        rect = element.CurrentBoundingRectangle
        return (rect.left, rect.top, rect.right, rect.bottom)
    except Exception:
        return (0, 0, 0, 0)


def _safe_cached_rect(element) -> tuple[int, int, int, int]:
    try:
        rect = element.CachedBoundingRectangle
        return (rect.left, rect.top, rect.right, rect.bottom)
    except Exception:
        return (0, 0, 0, 0)


def _safe_control_type(element) -> int:
    try:
        return element.CurrentControlType
    except Exception:
        return 0


def _safe_cached_control_type(element) -> int:
    try:
        return element.CachedControlType
    except Exception:
        return 0


def _safe_loc_control_type(element) -> str:
    try:
        return element.CachedLocalizedControlType or ""
    except Exception:
        return ""


def _safe_bool(element, prop: str) -> bool:
    try:
        return bool(getattr(element, prop))
    except Exception:
        return False


def _is_visible_cached(element) -> bool:
    try:
        if element.CachedIsOffscreen:
            return False
        rect = element.CachedBoundingRectangle
        w = rect.right - rect.left
        h = rect.bottom - rect.top
        return w > 0 and h > 0
    except Exception:
        return False


def _is_interactive(element) -> bool:
    try:
        ct = element.CachedControlType
        return ct in INTERACTIVE_TYPES
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Tree traversal — recursive walk with cache
# ---------------------------------------------------------------------------

def _build_cache_request(uia):
    req = uia.CreateCacheRequest()
    req.put_TreeScope(SCOPE_ELEMENT | SCOPE_CHILDREN)
    for prop_id in (
        PROP_NAME, PROP_CONTROL_TYPE, PROP_BOUNDING_RECT,
        PROP_IS_ENABLED, PROP_IS_OFFSCREEN, PROP_IS_CONTROL_ELEMENT,
        PROP_IS_KB_FOCUSABLE, PROP_HAS_KB_FOCUS,
    ):
        req.AddProperty(prop_id)
    for pat_id in (PATTERN_INVOKE, PATTERN_VALUE, PATTERN_SCROLL, PATTERN_TOGGLE):
        req.AddPattern(pat_id)
    return req


def _traverse_tree(element, window_name, depth, max_depth, max_nodes, cache_req):
    """Recursively walk UIA tree, collecting interactive nodes into selector map."""
    if depth > max_depth or (max_nodes and len(_selector_map) >= max_nodes):
        return

    try:
        cached = element.BuildUpdatedCache(cache_req)
    except Exception:
        return

    if not _is_visible_cached(cached):
        return

    if _is_interactive(cached):
        name = _safe_cached_name(cached)
        ct_id = _safe_cached_control_type(cached)
        ct_name = CONTROL_TYPE_NAMES.get(ct_id, "Unknown")
        loc_type = _safe_loc_control_type(cached)
        rect = _safe_cached_rect(cached)
        cx = (rect[0] + rect[2]) // 2
        cy = (rect[1] + rect[3]) // 2

        node = {
            "window": window_name,
            "control_type": ct_name,
            "name": name[:120] if name else "",
            "coords": f"({cx},{cy})",
            "rect": f"({rect[0]},{rect[1]},{rect[2]},{rect[3]})",
        }
        _add_to_selector_map(node, cached)

    # Enumerate children via BuildUpdatedCache result
    try:
        walker = _get_uia().RawViewWalker
        child = walker.GetFirstChildElement(cached)
        while child:
            try:
                _traverse_tree(child, window_name, depth + 1, max_depth, max_nodes, cache_req)
            except Exception:
                pass
            next_child = walker.GetNextSiblingElement(child)
            child.Release()
            child = next_child
    except Exception:
        pass


# ---------------------------------------------------------------------------
# EnumWindows — list visible windows
# ---------------------------------------------------------------------------

EnumWindows = ctypes.windll.user32.EnumWindows
GetWindowTextW = ctypes.windll.user32.GetWindowTextW
GetWindowTextLengthW = ctypes.windll.user32.GetWindowTextLengthW
IsWindowVisible = ctypes.windll.user32.IsWindowVisible
GetWindowRect = ctypes.windll.user32.GetWindowRect

_wnd_enum_callback_type = ctypes.WINFUNCTYPE(ctypes.wintypes.BOOL, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)


def _enumerate_windows():
    results = []

    def _cb(hwnd, _):
        if not IsWindowVisible(hwnd):
            return True
        length = GetWindowTextLengthW(hwnd)
        if length == 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value.strip()
        if not title:
            return True
        rect = ctypes.wintypes.RECT()
        GetWindowRect(hwnd, byref(rect))
        w = rect.right - rect.left
        h = rect.bottom - rect.top
        if w <= 1 or h <= 1:
            return True
        results.append({
            "hwnd": hwnd,
            "title": title,
            "rect": (rect.left, rect.top, rect.right, rect.bottom),
        })
        return True

    EnumWindows(_wnd_enum_callback_type(_cb), 0)
    return results


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_get_state(payload: dict) -> None:
    t0 = perf_counter()
    _clear_selector_map()

    uia = _get_uia()
    cache_req = _build_cache_request(uia)
    max_depth = int(payload.get("maxDepth", 50))
    max_nodes = int(payload.get("maxNodes", 1000))

    windows = _enumerate_windows()
    errors = []

    for win in windows:
        hwnd = win["hwnd"]
        window_name = win["title"]
        try:
            element = uia.ElementFromHandle(hwnd)
            if element:
                _traverse_tree(element, window_name, 0, max_depth, max_nodes, cache_req)
        except Exception as e:
            errors.append(f"{window_name}: {e}")
        if max_nodes and len(_selector_map) >= max_nodes:
            break

    # Build TOON-format text
    lines = []
    for idx, (node, _) in enumerate(_selector_map):
        line = f"{idx}|{node['window']}|{node['control_type']}|{node['name']}|{node['coords']}|"
        lines.append(line)

    elapsed = perf_counter() - t0
    result = {
        "toon_text": "\n".join(lines),
        "node_count": len(_selector_map),
        "window_count": len(windows),
        "elapsed_ms": round(elapsed * 1000),
    }
    if errors:
        result["errors"] = errors[:5]

    json_output({"ok": True, "result": result})


def _get_element_by_id(id_val: int):
    global _selector_map
    if id_val < 0 or id_val >= len(_selector_map):
        raise ValueError(f"Invalid element id: {id_val}, valid range: 0-{len(_selector_map)-1}")
    return _selector_map[id_val][1]


def cmd_click_by_id(payload: dict) -> None:
    import pyautogui
    element = _get_element_by_id(int(payload["id"]))
    rect = _safe_rect(element)
    x = (rect[0] + rect[2]) // 2
    y = (rect[1] + rect[3]) // 2
    pyautogui.moveTo(x, y)
    button = payload.get("button", "left")
    count = int(payload.get("count", 1))
    pyautogui.click(x=x, y=y, button=button, clicks=count, interval=0.05)
    json_output({"ok": True, "result": {"x": x, "y": y, "button": button, "count": count}})


def cmd_double_click_by_id(payload: dict) -> None:
    import pyautogui
    element = _get_element_by_id(int(payload["id"]))
    rect = _safe_rect(element)
    x = (rect[0] + rect[2]) // 2
    y = (rect[1] + rect[3]) // 2
    pyautogui.moveTo(x, y)
    pyautogui.click(x=x, y=y, button="left", clicks=2, interval=0.05)
    json_output({"ok": True, "result": {"x": x, "y": y}})


def cmd_type_by_id(payload: dict) -> None:
    import pyautogui
    element = _get_element_by_id(int(payload["id"]))
    text = str(payload.get("text", ""))
    clear_first = bool(payload.get("clear_first", False))

    # Try UIA ValuePattern first
    typed_via_pattern = False
    try:
        raw = element.GetCurrentPattern(PATTERN_VALUE)
        if raw:
            vp = raw.QueryInterface(IUIAutomationValuePattern)
            if clear_first:
                vp.put_Value("")
            vp.put_Value(text)
            typed_via_pattern = True
    except Exception:
        pass

    if not typed_via_pattern:
        # Fallback: click center then pyautogui
        rect = _safe_rect(element)
        x = (rect[0] + rect[2]) // 2
        y = (rect[1] + rect[3]) // 2
        pyautogui.click(x=x, y=y)
        if clear_first:
            pyautogui.hotkey("ctrl", "a")
            pyautogui.press("delete")
        pyautogui.write(text, interval=0.008)

    json_output({"ok": True, "result": {"typed": len(text), "via_pattern": typed_via_pattern}})


def cmd_scroll_by_id(payload: dict) -> None:
    element = _get_element_by_id(int(payload["id"]))
    direction = str(payload.get("direction", "down"))
    amount_name = str(payload.get("amount", "large_increment"))
    scroll_amount = SCROLL_AMOUNT_MAP.get(amount_name, SCROLL_LARGE_INCREMENT)

    try:
        raw = element.GetCurrentPattern(PATTERN_SCROLL)
        if raw:
            sp = raw.QueryInterface(IUIAutomationScrollPattern)
            if direction in ("up", "down"):
                sp.Scroll(SCROLL_NO_AMOUNT, scroll_amount if direction == "down" else SCROLL_LARGE_DECREMENT)
            else:
                sp.Scroll(scroll_amount if direction == "right" else SCROLL_LARGE_DECREMENT, SCROLL_NO_AMOUNT)
            json_output({"ok": True, "result": {"direction": direction, "amount": amount_name}})
            return
    except Exception:
        pass

    # Fallback: pyautogui scroll on element center
    import pyautogui
    rect = _safe_rect(element)
    x = (rect[0] + rect[2]) // 2
    y = (rect[1] + rect[3]) // 2
    clicks = 3 if amount_name.startswith("large") else 1
    if direction == "up":
        clicks = -clicks
    pyautogui.scroll(clicks, x=x, y=y)
    json_output({"ok": True, "result": {"direction": direction, "fallback": True}})


def cmd_screenshot(payload: dict) -> None:
    import mss
    from PIL import Image

    display_id = payload.get("displayId")
    with mss.mss() as sct:
        if display_id is not None and 0 <= display_id < len(sct.monitors) - 1:
            monitor = sct.monitors[display_id + 1]
        else:
            monitor = sct.monitors[1]  # primary
        raw = sct.grab(monitor)
        image = Image.frombytes("RGB", raw.size, raw.rgb)

    resize = None
    if payload.get("targetWidth") and payload.get("targetHeight"):
        resize = (int(payload["targetWidth"]), int(payload["targetHeight"]))
    if resize:
        image = image.resize(resize, Image.Resampling.LANCZOS)

    buf = BytesIO()
    image.save(buf, format="JPEG", quality=75, optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    json_output({
        "ok": True,
        "result": {
            "base64": b64,
            "width": image.width,
            "height": image.height,
        },
    })


# ---------------------------------------------------------------------------
# Main dispatcher (same pattern as win_helper.py)
# ---------------------------------------------------------------------------

COMMANDS = {
    "get_state":          cmd_get_state,
    "click_by_id":        cmd_click_by_id,
    "double_click_by_id": cmd_double_click_by_id,
    "type_by_id":         cmd_type_by_id,
    "scroll_by_id":       cmd_scroll_by_id,
    "screenshot":         cmd_screenshot,
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command")
    parser.add_argument("--payload", default="{}")
    args = parser.parse_args()

    try:
        payload = json.loads(args.payload)
    except json.JSONDecodeError as e:
        error_output(f"Invalid JSON payload: {e}", code="bad_payload")
        return 2

    handler = COMMANDS.get(args.command)
    if not handler:
        error_output(f"Unknown command: {args.command}", code="bad_command")
        return 2

    try:
        handler(payload)
        return 0
    except Exception as exc:
        error_output(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

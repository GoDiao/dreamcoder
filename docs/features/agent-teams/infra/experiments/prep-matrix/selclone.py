import ctypes, os, shutil, sys, time

libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
libc.clonefile.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint32]
CLONE_NOFOLLOW = 0x0001


def clone(src, dst):
    if libc.clonefile(src.encode(), dst.encode(), CLONE_NOFOLLOW) != 0:
        e = ctypes.get_errno()
        raise OSError(e, f"clonefile {src}: {os.strerror(e)}")


def walk(src, dst, rel, skips):
    if rel in skips:
        return
    if not any(s.startswith(rel + "/") for s in skips) and rel != "":
        clone(src, dst)
        return
    os.mkdir(dst)
    shutil.copystat(src, dst)
    for name in os.listdir(src):
        child = name if rel == "" else f"{rel}/{name}"
        walk(os.path.join(src, name), os.path.join(dst, name), child, skips)


src, dst, skips = sys.argv[1], sys.argv[2], set(sys.argv[3:])
t = time.monotonic()
walk(src, dst, "", skips)
print(f"selclone skip={sorted(skips)}: {time.monotonic() - t:.2f}s")

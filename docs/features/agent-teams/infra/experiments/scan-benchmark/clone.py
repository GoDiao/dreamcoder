import ctypes, os, sys, time

libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
libc.clonefile.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint32]
src, dst = sys.argv[1], sys.argv[2]
t = time.monotonic()
r = libc.clonefile(src.encode(), dst.encode(), 0)
dt = time.monotonic() - t
if r != 0:
    e = ctypes.get_errno()
    sys.exit(f"clonefile failed: {os.strerror(e)}")
print(f"clonefile {src} -> {dst}: {dt:.2f}s")

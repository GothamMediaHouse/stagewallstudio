#!/bin/bash
# usage: build.sh arm64|x86_64
set -euo pipefail
ARCH=$1
R=$HOME/Documents/Showcaller/Releases/Tools/ffmpeg-lgpl
SRC=$R/src/$ARCH
PREFIX=$R/build/$ARCH
LOG=$R/build/build-$ARCH.log
rm -rf "$SRC" "$PREFIX"; mkdir -p "$SRC" "$PREFIX"
exec > >(tee "$LOG") 2>&1
cd "$SRC"
tar xf $R/source/libvpx-1.15.2.tar.gz
tar xf $R/source/ffmpeg-7.1.5.tar.xz

export MACOSX_DEPLOYMENT_TARGET=11.0
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin   # nasm + pkg-config only
SDK=$(xcrun --sdk macosx --show-sdk-path)
CF="-arch $ARCH -mmacosx-version-min=11.0 -isysroot $SDK"

echo "=== libvpx $ARCH"
cd "$SRC/libvpx-1.15.2"
VPXCFG=(--target=$ARCH-darwin20-gcc --prefix="$PREFIX" --enable-static --disable-shared
  --disable-examples --disable-tools --disable-docs --disable-unit-tests
  --enable-vp9 --enable-vp8 --enable-pic)
echo "libvpx configure: ${VPXCFG[*]}" | tee "$PREFIX/libvpx-configure.txt"
CFLAGS="$CF" CXXFLAGS="$CF" LDFLAGS="$CF" ./configure "${VPXCFG[@]}"
make -j18
make install

echo "=== ffmpeg $ARCH"
cd "$SRC/ffmpeg-7.1.5"
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
export PKG_CONFIG_PATH=""
FFCFG=(--prefix="$PREFIX" --cc=clang --enable-static --disable-shared --disable-doc
  --disable-ffplay --disable-ffprobe --disable-autodetect
  --enable-videotoolbox --enable-audiotoolbox --enable-avfoundation
  ${SECURETRANSPORT:---enable-securetransport}
  --enable-zlib --enable-bzlib --enable-iconv --enable-libvpx
  --pkg-config=pkg-config --pkg-config-flags=--static --extra-libs=-liconv
  --extra-cflags="$CF" --extra-ldflags="$CF")
if [ "$ARCH" = x86_64 ]; then
  FFCFG+=(--arch=x86_64 --enable-cross-compile --target-os=darwin)
fi
echo "ffmpeg configure: ${FFCFG[*]}" | tee "$PREFIX/ffmpeg-configure.txt"
./configure "${FFCFG[@]}"
make -j18
make install
echo "=== done $ARCH"

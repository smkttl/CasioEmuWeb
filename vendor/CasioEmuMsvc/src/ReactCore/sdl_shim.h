#pragma once
// Minimal SDL surface used by the headless browser core. Rendering, image
// decoding and timers stay in the browser; the emulator only needs these
// declarations to keep its upstream signatures intact.
#include <cstdint>
#include <cstddef>
#include <cstdlib>
#include <emscripten.h>

using Uint8 = std::uint8_t;
using Uint16 = std::uint16_t;
using Uint32 = std::uint32_t;
using Sint32 = std::int32_t;
using Uint64 = std::uint64_t;
using SDL_FingerID = long long;
enum SDL_KeyCode : std::int32_t {
    SDLK_F11 = 0x40000000 + 0x0B,
    SDLK_F12 = 0x40000000 + 0x0C,
};
using SDL_Keycode = SDL_KeyCode;
using SDL_TimerID = std::uint32_t;
using SDL_AudioDeviceID = std::uint32_t;
using SDL_BlendMode = std::uint32_t;
using SDL_bool = bool;

struct SDL_Rect {
    int x, y, w, h;
    SDL_Rect() = default;
    constexpr SDL_Rect(int rect_x, int rect_y, int rect_w, int rect_h)
        : x(rect_x), y(rect_y), w(rect_w), h(rect_h) {}
};
// Mirrors SDL_rect.h's public guard so upstream Rect conversion helpers stay
// available without pulling in the real SDL headers.
#define SDL_rect_h_ 1
struct SDL_Color { Uint8 r, g, b, a; };
struct SDL_Renderer;
struct SDL_Texture;
struct SDL_PixelFormat {
    Uint8 BytesPerPixel = 4;
};
struct SDL_Surface {
    int w = 0, h = 0;
    int pitch = 0;
    void* pixels = nullptr;
    SDL_PixelFormat* format = nullptr;
};
struct SDL_Window;
struct SDL_RWops;

struct SDL_Event {
    Uint32 type;
    struct { int x, y, button; } button;
    struct { SDL_FingerID fingerId; float x, y; } tfinger;
    struct { SDL_Keycode sym; Uint32 state; Uint16 mod; } keysym;
    struct { struct { SDL_Keycode sym; Uint32 state; Uint16 mod; } keysym; Uint32 state; } key;
};

constexpr Uint32 SDL_PRESSED = 1;
constexpr Uint32 SDL_RELEASED = 0;
constexpr Uint32 SDL_BUTTON_LEFT = 1;
constexpr Uint32 SDL_BUTTON_RIGHT = 3;
constexpr Uint32 SDL_FINGERDOWN = 1;
constexpr Uint32 SDL_FINGERUP = 2;
constexpr Uint32 SDL_MOUSEBUTTONDOWN = 3;
constexpr Uint32 SDL_MOUSEBUTTONUP = 4;
constexpr SDL_Keycode SDLK_UNKNOWN = static_cast<SDL_KeyCode>(0);
constexpr Uint32 SDL_INIT_TIMER = 1;
constexpr Uint32 SDL_INIT_AUDIO = 16;
constexpr Uint32 SDL_BLENDMODE_BLEND = 1;
constexpr Uint32 SDL_PIXELFORMAT_RGBA32 = 0x16462004;
constexpr Uint32 SDL_BLENDMODE_NONE = 0;
constexpr Uint32 SDL_KEYDOWN = 5;
constexpr Uint32 SDL_KEYUP = 6;
constexpr Uint16 KMOD_LCTRL = 0x0040;
constexpr Uint32 SDL_RENDERER_ACCELERATED = 2;
constexpr Uint32 SDL_RENDERER_TARGETTEXTURE = 8;
constexpr Uint32 SDL_TEXTUREACCESS_STREAMING = 1;
constexpr Uint32 SDL_TEXTUREACCESS_TARGET = 2;
constexpr int SDL_WINDOWPOS_UNDEFINED = 0x1FFF0000;
constexpr Uint32 SDL_WINDOW_HIDDEN = 8;
constexpr Uint32 SDL_WINDOW_RESIZABLE = 32;
constexpr int SDL_ScaleModeNearest = 0;
constexpr const char* SDL_HINT_RENDER_DRIVER = "SDL_RENDER_DRIVER";
constexpr const char* SDL_HINT_RENDER_SCALE_QUALITY = "SDL_RENDER_SCALE_QUALITY";

struct SDL_RendererInfo { const char* name; Uint32 flags; Uint32 num_texture_formats; Uint32 texture_formats[16]; int max_texture_width; int max_texture_height; };

using SDL_AudioCallback = void (*)(void*, Uint8*, int);
struct SDL_AudioSpec {
    int freq;
    Uint16 format;
    Uint8 channels;
    Uint8 silence;
    Uint16 samples;
    Uint16 padding;
    Uint32 size;
    SDL_AudioCallback callback;
    void* userdata;
};
constexpr Uint16 AUDIO_S16SYS = 0x8010;

inline Uint64 SDL_GetTicks64() {
    return static_cast<Uint64>(emscripten_get_now());
}
inline Uint32 SDL_GetTicks() { return static_cast<Uint32>(SDL_GetTicks64()); }
inline int SDL_InitSubSystem(Uint32) { return 0; }
inline int SDL_Init(Uint32) { return 0; }
inline void SDL_Delay(Uint32) {}
inline void SDL_Log(const char*, ...) {}
inline const char* SDL_GetError() { return ""; }
inline void SDL_ClearError() {}
inline int SDL_SetHint(const char*, const char*) { return 1; }
inline const char* SDL_GetHint(const char*) { return nullptr; }
inline void SDL_SetError(const char*, ...) {}
inline int SDL_IntersectRect(const SDL_Rect*, const SDL_Rect*, SDL_Rect*) { return 0; }
inline int SDL_GetRGBA(Uint32, const SDL_PixelFormat*, Uint8* r, Uint8* g, Uint8* b, Uint8* a) { if (r) *r = 255; if (g) *g = 255; if (b) *b = 255; if (a) *a = 0; return 0; }
inline Uint32 SDL_MapRGBA(const SDL_PixelFormat*, Uint8, Uint8, Uint8, Uint8) { return 0; }
inline SDL_Surface* SDL_ConvertSurfaceFormat(SDL_Surface*, Uint32, Uint32) { return nullptr; }
inline SDL_Surface* SDL_CreateRGBSurfaceWithFormat(Uint32, int, int, int, Uint32) { return nullptr; }
inline SDL_Surface* SDL_CreateRGBSurfaceWithFormatFrom(void*, int, int, int, int, Uint32) { return nullptr; }
inline int SDL_LockSurface(SDL_Surface*) { return 0; }
inline void SDL_UnlockSurface(SDL_Surface*) {}
inline int SDL_RenderReadPixels(SDL_Renderer*, const SDL_Rect*, Uint32, void*, int) { return -1; }
inline int SDL_SetTextureScaleMode(SDL_Texture*, int) { return 0; }
inline void SDL_PauseAudioDevice(SDL_AudioDeviceID, int) {}
inline void SDL_CloseAudioDevice(SDL_AudioDeviceID) {}
inline SDL_AudioDeviceID SDL_OpenAudioDevice(const char*, int, const SDL_AudioSpec*, SDL_AudioSpec*, int) { return 0; }
inline SDL_TimerID SDL_AddTimer(Uint32, Uint32 (*)(Uint32, void*), void*) { return 0; }
inline int SDL_RemoveTimer(SDL_TimerID) { return 1; }
inline int SDL_RenderSetViewport(SDL_Renderer*, const SDL_Rect*) { return 0; }
inline int SDL_RenderSetScale(SDL_Renderer*, float, float) { return 0; }
inline int SDL_RenderSetClipRect(SDL_Renderer*, const SDL_Rect*) { return 0; }
inline int SDL_SetRenderDrawColor(SDL_Renderer*, Uint8, Uint8, Uint8, Uint8) { return 0; }
inline int SDL_RenderFillRect(SDL_Renderer*, const SDL_Rect*) { return 0; }
inline int SDL_RenderCopy(SDL_Renderer*, SDL_Texture*, const SDL_Rect*, const SDL_Rect*) { return 0; }
inline int SDL_SetTextureColorMod(SDL_Texture*, Uint8, Uint8, Uint8) { return 0; }
inline int SDL_SetTextureAlphaMod(SDL_Texture*, Uint8) { return 0; }
inline int SDL_SetTextureBlendMode(SDL_Texture*, Uint32) { return 0; }
inline void SDL_DestroyTexture(SDL_Texture*) {}
inline void SDL_FreeSurface(SDL_Surface*) {}
inline SDL_Texture* SDL_CreateTextureFromSurface(SDL_Renderer*, SDL_Surface*) { return nullptr; }
inline SDL_Renderer* SDL_CreateRenderer(SDL_Window*, int, Uint32) { return nullptr; }
inline SDL_Window* SDL_CreateWindow(const char*, int, int, int, int, Uint32) { return nullptr; }
inline void SDL_DestroyRenderer(SDL_Renderer*) {}
inline void SDL_DestroyWindow(SDL_Window*) {}
inline void SDL_GetWindowSize(SDL_Window*, int* w, int* h) { if (w) *w = 0; if (h) *h = 0; }
inline int SDL_PollEvent(SDL_Event*) { return 0; }
inline SDL_Keycode SDL_GetKeyFromName(const char*) { return SDLK_UNKNOWN; }
inline const char* SDL_GetKeyName(SDL_Keycode) { return ""; }
inline SDL_RWops* SDL_RWFromConstMem(const void*, int) { return nullptr; }
inline int SDL_RWclose(SDL_RWops*) { return 0; }
inline int SDL_GetRendererInfo(SDL_Renderer*, void*) { return -1; }
inline int SDL_QueryTexture(SDL_Texture*, Uint32*, int*, int*, int*) { return -1; }
inline SDL_Texture* SDL_CreateTexture(SDL_Renderer*, Uint32, int, int, int) { return nullptr; }
inline int SDL_SetRenderTarget(SDL_Renderer*, SDL_Texture*) { return 0; }
inline SDL_Texture* SDL_GetRenderTarget(SDL_Renderer*) { return nullptr; }
inline int SDL_GetRendererOutputSize(SDL_Renderer*, int*, int*) { return -1; }
inline int SDL_UpdateTexture(SDL_Texture*, const SDL_Rect*, const void*, int) { return 0; }
inline void SDL_RenderGetViewport(SDL_Renderer*, SDL_Rect*) {}
inline void SDL_RenderGetScale(SDL_Renderer*, float*, float*) {}
inline void SDL_RenderGetClipRect(SDL_Renderer*, SDL_Rect*) {}
inline int SDL_RenderIsClipEnabled(SDL_Renderer*) { return 0; }
inline int SDL_GetRenderDrawBlendMode(SDL_Renderer*, Uint32*) { return 0; }
inline int SDL_SetRenderDrawBlendMode(SDL_Renderer*, Uint32) { return 0; }
inline int SDL_RenderClear(SDL_Renderer*) { return 0; }
inline int SDL_RenderPresent(SDL_Renderer*) { return 0; }
inline SDL_Surface* IMG_Load_RW(SDL_RWops*, int) { return nullptr; }
inline SDL_Surface* IMG_Load(const char*) { return nullptr; }
inline SDL_Surface* IMG_LoadSizedSVG_RW(SDL_RWops*, int, int) { return nullptr; }
inline const char* IMG_GetError() { return ""; }
inline int IMG_SavePNG(SDL_Surface*, const char*) { return -1; }

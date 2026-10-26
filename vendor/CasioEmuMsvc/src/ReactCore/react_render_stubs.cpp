// The browser frontend rasterizes imported skins and LCD frames itself. The
// emulator's headless build still owns texture-cache objects, so provide inert
// implementations of their SDL-facing API without linking SDL_image.
#include "Peripheral/ScreenRenderSupport.hpp"

#include <utility>

namespace casioemu {
	SDL_Texture* CreateSvgSpriteTexture(
		SDL_Renderer*,
		const SpriteInfo&,
		int,
		int,
		SDL_Rect*) {
		return nullptr;
	}

	SvgSpriteTextureCache::SvgSpriteTextureCache(SvgSpriteTextureCache&& other) noexcept {
		MoveFrom(other);
	}

	SvgSpriteTextureCache& SvgSpriteTextureCache::operator=(SvgSpriteTextureCache&& other) noexcept {
		if (this != &other) {
			Reset();
			MoveFrom(other);
		}
		return *this;
	}

	SvgSpriteTextureCache::~SvgSpriteTextureCache() {
		Reset();
	}

	void SvgSpriteTextureCache::Reset() {
		texture = nullptr;
		width = 0;
		height = 0;
		shape_size = 0;
		shape_hash = 0;
		content_bounds = {};
		software_renderer = false;
	}

	SDL_Texture* SvgSpriteTextureCache::Get(
		SDL_Renderer*,
		const SpriteInfo&,
		int,
		int) {
		return nullptr;
	}

	bool SvgSpriteTextureCache::ContentClip(const SDL_Rect& dest, SDL_Rect& clip) const {
		clip = {};
		(void)dest;
		return false;
	}

	void SvgSpriteTextureCache::MoveFrom(SvgSpriteTextureCache& other) noexcept {
		texture = other.texture;
		width = other.width;
		height = other.height;
		shape_size = other.shape_size;
		shape_hash = other.shape_hash;
		content_bounds = other.content_bounds;
		software_renderer = other.software_renderer;
		other.Reset();
	}

	std::pair<int, int> CurrentRenderTargetSpriteSize(SDL_Renderer*, const SDL_Rect&) {
		return {0, 0};
	}

	void RenderModelSprite(
		SDL_Renderer*,
		SDL_Texture*,
		SvgSpriteTextureCache*,
		const SpriteInfo&,
		const ColourInfo&,
		uint8_t) {
	}
}

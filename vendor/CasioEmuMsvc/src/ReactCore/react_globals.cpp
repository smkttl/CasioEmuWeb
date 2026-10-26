// Shared globals normally owned by the desktop frontend. The React host links
// only the emulator core, so these values need inert defaults here.
#include "Chipset/MMU.hpp"

#include <cstdint>

namespace casioemu {
	class Emulator;
}

extern casioemu::MMU* me_mmu;

char* n_ram_buffer = nullptr;
casioemu::MMU* me_mmu = nullptr;
casioemu::Emulator* m_emu = nullptr;
uint32_t pc_cache = 0;
bool low_perf_ext = true;
float screen_fading_blending_coefficient = 0.0f;
float screen_flashing_brightness_coeff = 1.5f;
bool screen_residual_enabled = true;
float screen_residual_alpha_scale = 1.0f;
int screen_buffer_select = 0;
bool audio_enable = false;

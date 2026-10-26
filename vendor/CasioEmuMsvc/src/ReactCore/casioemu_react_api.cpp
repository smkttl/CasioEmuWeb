#include "Chipset/Chipset.hpp"
#include "Chipset/CPU.hpp"
#include "Chipset/MMU.hpp"
#include "Chipset/T4xCore.hpp"
#include "Chipset/ePSCpu.h"
#include "Compress.h"
#include "Emulator.hpp"
#include "Ext/U8Disas.h"
#include "Ext/ePSDisas.h"
#include "ModelConfig.h"
#include "ModelInfo.h"
#include "ModelResourceStore.h"
#include "Models.h"
#include "Peripheral/BatteryBackedRAM.hpp"
#include "Peripheral/Keyboard.hpp"
#include "Peripheral/Screen.hpp"
#include "ReactCore/react_api.h"

#ifdef CASIOEMU_REACT_CORE
#include "ReactCore/sdl_shim.h"
#else
#include <SDL.h>
#endif
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <iomanip>
#include <map>
#include <memory>
#include <sstream>
#include <string>
#include <typeinfo>
#include <utility>
#include <vector>

extern "C" {
int ce_tick_frame();
void ce_shutdown();
}

namespace {
	using casioemu::HardwareId;
	using casioemu::ModelInfo;
	using casioemu::ModelResourceStore;
	using casioemu::MemoryModelResourceStore;

	constexpr int kMaxTextResult = 1 << 20;
	constexpr int kMaxSnapshotBytes = 256 << 20;
	constexpr int kMaxResourceBytes = 64 << 20;

	std::unique_ptr<casioemu::Emulator> g_emulator;
	std::map<std::string, std::vector<uint8_t>> g_staged_resources;
	std::string g_last_error;
	std::vector<uint8_t> g_frame_rgba;
	std::vector<uint8_t> g_status_alpha;
	std::vector<uint8_t> g_snapshot;
	std::vector<uint8_t> g_persistent;
	std::string g_text_result;
	int g_frame_width = 0;
	int g_frame_height = 0;
	int g_display_r = 0;
	int g_display_g = 0;
	int g_display_b = 0;
	bool g_had_status_row = false;
	Uint64 g_last_cpu_tick = 0;
	Uint64 g_last_emu_tick = 0;
	std::vector<casioemu::ExecutionBreakpoint> g_execution_breakpoints;
	std::vector<casioemu::MemoryBreakpoint> g_memory_breakpoints;
	bool g_sdl_ready = false;

	void SetError(const std::string& message) {
		g_last_error = message;
		std::fprintf(stderr, "[CasioEmuWeb] %s\n", message.c_str());
	}

	void ClearFrame() {
		g_frame_rgba.clear();
		g_status_alpha.clear();
		g_frame_width = 0;
		g_frame_height = 0;
		g_had_status_row = false;
	}

	void ResetClock() {
		if (!g_sdl_ready) {
			SDL_InitSubSystem(SDL_INIT_TIMER);
			g_sdl_ready = true;
		}
		g_last_cpu_tick = SDL_GetTicks64();
		g_last_emu_tick = g_last_cpu_tick;
	}

	casioemu::IScreenFrameProvider* Screen() {
		return g_emulator ? g_emulator->chipset.QueryInterface<casioemu::IScreenFrameProvider>() : nullptr;
	}

	casioemu::IKeyboardAutomation* Keyboard() {
		return g_emulator ? g_emulator->chipset.QueryInterface<casioemu::IKeyboardAutomation>() : nullptr;
	}

	uint32_t CurrentPc() {
		if (!g_emulator) return 0;
		if (g_emulator->chipset.t4x) return g_emulator->chipset.t4x->ProgramCounter();
		if (g_emulator->chipset.epscpu) return g_emulator->chipset.epscpu->ProgramCounter();
		return (static_cast<uint32_t>(g_emulator->chipset.cpu.reg_csr.raw) << 16) |
			static_cast<uint32_t>(g_emulator->chipset.cpu.reg_pc.raw);
	}

	void PumpClock() {
		if (!g_emulator || !g_emulator->Running()) return;
		const Uint64 now = SDL_GetTicks64();
		if (g_last_cpu_tick == 0) ResetClock();
		int catchup = 0;
		while (now >= g_last_cpu_tick + g_emulator->timer_interval && catchup < 4) {
			g_emulator->TimerCallback();
			g_last_cpu_tick += g_emulator->timer_interval;
			++catchup;
		}
		if (catchup == 4 && now > g_last_cpu_tick + 250) g_last_cpu_tick = now;
		if (now >= g_last_emu_tick + 25) {
			g_emulator->chipset.EmulatorTick();
			g_last_emu_tick = now;
		}
	}

	template <typename T>
	void CopyText(std::string& value, T* out, int capacity) {
		if (!out || capacity <= 0) return;
		const int length = std::min<int>(static_cast<int>(value.size()), capacity - 1);
		std::memcpy(out, value.data(), static_cast<size_t>(length));
		out[length] = 0;
	}

	std::string DecodeU8(uint32_t address, int* consumed) {
		if (!g_emulator) return {};
		std::vector<uint8_t> bytes(16, 0);
		for (size_t i = 0; i < bytes.size(); ++i) {
			const size_t source = address + i;
			bytes[i] = source < g_emulator->chipset.rom_data.size() ? g_emulator->chipset.rom_data[source] : 0xFF;
		}
		std::stringstream stream;
		uint8_t* cursor = bytes.data();
		const uint8_t* before = cursor;
		decode(stream, cursor, address);
		*consumed = static_cast<int>(cursor - before);
		return stream.str();
	}

	std::string DecodeEps(uint32_t address, int* consumed) {
		if (!g_emulator || !g_emulator->chipset.epscpu) return {};
		const size_t word_count = g_emulator->chipset.epscpu->RomWordCount();
		std::vector<char> disasm((word_count + 1) * 4, 0);
		for (size_t i = 0; i <= word_count; ++i) {
			const uint16_t word = g_emulator->chipset.epscpu->ReadCodeWord(static_cast<uint32_t>(i));
			disasm[i * 4 + 0] = static_cast<char>((word >> 12) & 0xF);
			disasm[i * 4 + 1] = static_cast<char>((word >> 8) & 0xF);
			disasm[i * 4 + 2] = static_cast<char>((word >> 4) & 0xF);
			disasm[i * 4 + 3] = static_cast<char>(word & 0xF);
		}
		bool is_long = false;
		char* result = decodeeps(disasm.data(), static_cast<int>(address), is_long);
		std::string text = result ? result : "";
		std::free(result);
		*consumed = is_long ? 4 : 2;
		return text;
	}

	const char* StopReasonName(casioemu::DebugStopReason reason) {
		switch (reason) {
		case casioemu::DebugStopReason::Step: return "step";
		case casioemu::DebugStopReason::StepOver: return "step-over";
		case casioemu::DebugStopReason::StepOut: return "step-out";
		case casioemu::DebugStopReason::RunToAddress: return "run-to";
		case casioemu::DebugStopReason::ExecutionBreakpoint: return "execution-breakpoint";
		case casioemu::DebugStopReason::MemoryBreakpoint: return "memory-breakpoint";
		case casioemu::DebugStopReason::Hook: return "hook";
		case casioemu::DebugStopReason::Break: return "break";
		default: return "none";
		}
	}

	void SyncBreakpointCache() {
		g_execution_breakpoints.clear();
		g_memory_breakpoints.clear();
		if (!g_emulator) return;
		if (auto* core = g_emulator->chipset.t4x) {
			g_execution_breakpoints = core->ExecutionBreakpointDetails();
			g_memory_breakpoints = core->MemoryBreakpoints();
		}
		else if (auto* eps = g_emulator->chipset.epscpu) {
			g_execution_breakpoints = eps->ExecutionBreakpointDetails();
			g_memory_breakpoints = eps->MemoryBreakpoints();
		}
	}

	void AppendLe32(std::vector<uint8_t>& out, uint32_t value) {
		for (int i = 0; i < 4; ++i) out.push_back(static_cast<uint8_t>(value >> (i * 8)));
	}

	uint32_t LoadLe32(const uint8_t* in) {
		return static_cast<uint32_t>(in[0]) |
			(static_cast<uint32_t>(in[1]) << 8) |
			(static_cast<uint32_t>(in[2]) << 16) |
			(static_cast<uint32_t>(in[3]) << 24);
	}

	IRam* RamPeripheral() {
		return g_emulator
			? static_cast<IRam*>(g_emulator->chipset.QueryInterface(typeid(IRam).name()))
			: nullptr;
	}

	std::vector<uint8_t> PersistentPayload() {
		if (!g_emulator) return {};
		if (auto* eps = g_emulator->chipset.epscpu) return eps->ExportRam();
		if (g_emulator->hardware_id == casioemu::HW_FX_5800P) {
			auto* ram = RamPeripheral();
			if (!ram || !ram->GetRam() || !ram->GetPRam()) return {};
			constexpr size_t kPramBytes = 0x8000;
			constexpr size_t kFlashBytes = 0x80000;
			const size_t ram_size = casioemu::GetRamSize(casioemu::HW_FX_5800P);
			if (g_emulator->chipset.flash_data.size() < kFlashBytes) return {};
			std::vector<uint8_t> data(ram_size + kPramBytes + kFlashBytes);
			std::memcpy(data.data(), ram->GetRam(), ram_size);
			std::memcpy(data.data() + ram_size, ram->GetPRam(), kPramBytes);
			std::memcpy(data.data() + ram_size + kPramBytes,
				g_emulator->chipset.flash_data.data(), kFlashBytes);
			return data;
		}
		if (auto* ram = RamPeripheral()) {
			if (!ram->GetRam()) return {};
			const size_t size = casioemu::GetRamSize(g_emulator->hardware_id);
			const auto* bytes = static_cast<const uint8_t*>(ram->GetRam());
			return {bytes, bytes + size};
		}
		return {};
	}

	bool LoadPersistentPayload(const std::vector<uint8_t>& data) {
		if (!g_emulator || data.empty()) return false;
		if (auto* eps = g_emulator->chipset.epscpu) return eps->ImportRam(data);
		if (g_emulator->hardware_id == casioemu::HW_FX_5800P) {
			auto* ram = RamPeripheral();
			if (!ram || !ram->GetRam() || !ram->GetPRam()) return false;
			constexpr size_t kPramBytes = 0x8000;
			constexpr size_t kFlashBytes = 0x80000;
			const size_t ram_size = casioemu::GetRamSize(casioemu::HW_FX_5800P);
			if (data.size() != ram_size + kPramBytes + kFlashBytes) return false;
			if (g_emulator->chipset.flash_data.size() < kFlashBytes) return false;
			std::memcpy(ram->GetRam(), data.data(), ram_size);
			std::memcpy(ram->GetPRam(), data.data() + ram_size, kPramBytes);
			std::memcpy(g_emulator->chipset.flash_data.data(),
				data.data() + ram_size + kPramBytes, kFlashBytes);
			return true;
		}
		if (auto* ram = RamPeripheral()) {
			if (!ram->GetRam()) return false;
			const size_t size = casioemu::GetRamSize(g_emulator->hardware_id);
			if (data.size() != size) return false;
			std::memcpy(ram->GetRam(), data.data(), size);
			return true;
		}
		return false;
	}

	bool RunNativeStep(casioemu::DebugStopReason requested) {
		if (!g_emulator) return false;
		g_emulator->SetPaused(true);
		if (auto* core = g_emulator->chipset.t4x) {
			if (requested == casioemu::DebugStopReason::Step) core->RequestStepInto();
			else if (requested == casioemu::DebugStopReason::StepOver) core->RequestStepOver();
			else if (!core->RequestStepOut()) return false;
			for (int i = 0; i < 1000000; ++i) {
				core->RunBatch(1);
				if (core->LastDebugStop().stopped()) return true;
			}
			return false;
		}
		if (auto* eps = g_emulator->chipset.epscpu) {
			if (requested == casioemu::DebugStopReason::Step) eps->RequestStepInto();
			else if (requested == casioemu::DebugStopReason::StepOver) eps->RequestStepOver();
			else if (!eps->RequestStepOut()) return false;
			for (int i = 0; i < 1000000; ++i) {
				eps->Next();
				if (eps->LastDebugStop().stopped()) return true;
			}
			return false;
		}
		return false;
	}

	void WriteJsonRect(std::ostringstream& out, const Rect& rect) {
		out << "{\"x\":" << rect.x << ",\"y\":" << rect.y
			<< ",\"w\":" << rect.w << ",\"h\":" << rect.h << "}";
	}

	void WriteJsonString(std::ostringstream& out, const std::string& value) {
		out << '"';
		for (const unsigned char ch : value) {
			switch (ch) {
			case '"': out << "\\\""; break;
			case '\\': out << "\\\\"; break;
			case '\b': out << "\\b"; break;
			case '\f': out << "\\f"; break;
			case '\n': out << "\\n"; break;
			case '\r': out << "\\r"; break;
			case '\t': out << "\\t"; break;
			default:
				if (ch < 0x20) {
					out << "\\u" << std::hex << std::setw(4) << std::setfill('0')
						<< static_cast<unsigned>(ch) << std::dec;
				}
				else {
					out << static_cast<char>(ch);
				}
				break;
			}
		}
		out << '"';
	}

	void WriteJsonSprite(std::ostringstream& out, const casioemu::SpriteInfo& sprite) {
		out << "{\"src\":";
		WriteJsonRect(out, sprite.src);
		out << ",\"dest\":";
		WriteJsonRect(out, sprite.dest);
		if (!sprite.svg_shape.empty()) {
			out << ",\"svgShape\":";
			WriteJsonString(out, sprite.svg_shape);
		}
		if (!sprite.svg_defs.empty()) {
			out << ",\"svgDefs\":";
			WriteJsonString(out, sprite.svg_defs);
		}
		out << '}';
	}

	std::string ModelInfoJson() {
		if (!g_emulator) return "{}";
		const auto& model = g_emulator->ModelDefinition;
		std::ostringstream out;
		out << "{";
		out << "\"format\":\"CasioEmuMsvc.ModelInfo\",\"version\":1";
		out << ",\"modelName\":";
		WriteJsonString(out, model.model_name);
		out << ",\"hardwareId\":" << model.hardware_id;
		out << ",\"hardwareName\":";
		WriteJsonString(out, casioemu::HardwareDisplayName(model.hardware_id));
		out << ",\"csrMask\":" << model.csr_mask;
		out << ",\"realHardware\":" << (model.real_hardware ? "true" : "false");
		out << ",\"pdValue\":" << static_cast<unsigned>(model.pd_value);
		out << ",\"interfacePath\":";
		WriteJsonString(out, model.interface_path);
		out << ",\"boardPath\":";
		WriteJsonString(out, model.board_path);
		out << ",\"romPath\":";
		WriteJsonString(out, model.rom_path);
		out << ",\"flashPath\":";
		WriteJsonString(out, model.flash_path);
		out << ",\"inkColor\":{\"r\":" << model.ink_color.r << ",\"g\":" << model.ink_color.g
			<< ",\"b\":" << model.ink_color.b << "}";
		out << ",\"enableNewScreen\":" << (model.enable_new_screen ? "true" : "false");
		out << ",\"isSampleRom\":" << (model.is_sample_rom ? "true" : "false");
		out << ",\"legacyKo\":" << (model.legacy_ko ? "true" : "false");
		out << ",\"u16Mode\":" << (model.u16_mode ? "true" : "false");
		out << ",\"largeModel\":" << (model.LARGE_model ? "true" : "false");
		out << ",\"ml620Mirroring\":" << (model.ml620_mirroring ? "true" : "false");
		out << ",\"screenWidth\":" << model.screen_width;
		out << ",\"screenHeight\":" << model.screen_height;
		out << ",\"screenScaleY\":" << model.screen_scale_y;
		out << ",\"source\":";
		WriteJsonString(out, g_staged_resources.contains(casioemu::MODEL_CONFIG_JSON) ? "json" : "bin");

		out << ",\"sprites\":{";
		bool first = true;
		for (const auto& [name, sprite] : model.sprites) {
			if (!first) out << ",";
			first = false;
			WriteJsonString(out, name);
			out << ":";
			WriteJsonSprite(out, sprite);
		}
		out << "}";

		out << ",\"statusSpriteIndexes\":{";
		first = true;
		for (const auto& [name, index] : model.status_sprite_indexes) {
			if (!first) out << ",";
			first = false;
			WriteJsonString(out, name);
			out << ":" << index;
		}
		out << "}";

		out << ",\"statusIndicators\":[";
		for (size_t i = 0; i < model.status_indicators.size(); ++i) {
			const auto& indicator = model.status_indicators[i];
			if (i) out << ",";
			out << "{\"sprite\":";
			WriteJsonString(out, indicator.sprite_name);
			out << ",\"byte\":" << indicator.byte_offset << ",\"bit\":" << static_cast<unsigned>(indicator.bit)
				<< "}";
		}
		out << "]";

		out << ",\"buttons\":[";
		for (size_t i = 0; i < model.buttons.size(); ++i) {
			const auto& button = model.buttons[i];
			if (i) out << ",";
			out << "{\"id\":";
			WriteJsonString(out, "kiko-" + std::to_string(button.kiko));
			out << ",\"rect\":";
			WriteJsonRect(out, button.rect);
			out << ",\"kiko\":" << button.kiko << ",\"keyname\":";
			WriteJsonString(out, button.keyname);
			if (!button.svg_shape.empty()) {
				out << ",\"svgShape\":";
				WriteJsonString(out, button.svg_shape);
			}
			if (!button.svg_defs.empty()) {
				out << ",\"svgDefs\":";
				WriteJsonString(out, button.svg_defs);
			}
			out << '}';
		}
		out << "]";

		out << ",\"extra\":{";
		first = true;
		for (const auto& [key, value] : model.extra) {
			if (!first) out << ",";
			first = false;
			WriteJsonString(out, key);
			out << ":";
			WriteJsonString(out, value);
		}
		out << "}";

		out << ",\"frame\":{\"width\":" << g_frame_width << ",\"height\":" << g_frame_height
			<< ",\"hasStatusRow\":" << (g_had_status_row ? "true" : "false") << "}";
		out << ",\"capabilities\":{\"native\":true,\"debugger\":"
			<< ((g_emulator->chipset.t4x || g_emulator->chipset.epscpu) ? "true" : "false")
			<< ",\"snapshots\":true,\"memory\":true,\"disassembly\":true}";
		out << "}";
		return out.str();
	}
}

extern "C" {

int ce_begin_model() {
	ce_shutdown();
	g_staged_resources.clear();
	g_last_error.clear();
	return 0;
}

int ce_add_resource(const char* path, const uint8_t* data, int length) {
	if (!path || !*path || !data || length < 0 || length > kMaxResourceBytes) {
		SetError("Invalid model resource.");
		return -1;
	}
	try {
		std::string name(path);
		std::replace(name.begin(), name.end(), '\\', '/');
		if (name.empty() || name.front() == '/' || name.find("..") != std::string::npos ||
			name.find(':') != std::string::npos || name.find("//") != std::string::npos) {
			SetError("Model resource paths must be relative and safe.");
			return -2;
		}
		if (g_staged_resources.contains(name)) {
			SetError("Duplicate model resource: " + name);
			return -3;
		}
		g_staged_resources[name] = std::vector<uint8_t>(data, data + length);
		return 0;
	}
	catch (const std::exception& error) {
		SetError(error.what());
		return -4;
	}
}

int ce_load_model() {
	try {
		if (!g_staged_resources.contains(casioemu::MODEL_CONFIG_JSON) &&
			!g_staged_resources.contains(casioemu::MODEL_CONFIG_BIN)) {
			SetError("config.json or config.bin is required.");
			return -1;
		}
		g_emulator.reset();
		g_last_error.clear();
		auto store = std::make_shared<casioemu::MemoryModelResourceStore>(
			std::map<std::string, std::vector<uint8_t>>(g_staged_resources));
		ModelInfo model;
		std::string error;
		if (!casioemu::LoadModelInfoFromResourceStore(*store, model, &error)) {
			SetError("Model configuration: " + error);
			return -2;
		}
		ResetClock();
		g_emulator = std::make_unique<casioemu::Emulator>(model, true, true, "", store);
		ResetClock();
		ce_tick_frame();
		g_last_error.clear();
		return 0;
	}
	catch (const std::exception& error) {
		SetError(error.what());
		g_emulator.reset();
		ClearFrame();
		return -3;
	}
	catch (...) {
		SetError("Unknown model initialization error.");
		g_emulator.reset();
		ClearFrame();
		return -4;
	}
}

const char* ce_model_info_json() {
	g_text_result = ModelInfoJson();
	return g_text_result.c_str();
}

void ce_shutdown() {
	g_emulator.reset();
	g_staged_resources.clear();
	ClearFrame();
	g_snapshot.clear();
	g_persistent.clear();
	g_execution_breakpoints.clear();
	g_memory_breakpoints.clear();
	g_last_error.clear();
}

int ce_start() {
	if (!g_emulator) return -1;
	g_emulator->SetPaused(false);
	ResetClock();
	return 0;
}

int ce_pause(int paused) {
	if (!g_emulator) return -1;
	g_emulator->SetPaused(paused != 0);
	return 0;
}

int ce_reset() {
	if (!g_emulator) return -1;
	try {
		g_emulator->SetPaused(true);
		g_emulator->chipset.Reset();
		ClearFrame();
		ResetClock();
		return 0;
	}
	catch (const std::exception& error) {
		SetError(error.what());
		return -2;
	}
}

int ce_tick_frame() {
	if (!g_emulator) return -1;
	PumpClock();
	auto* screen = Screen();
	if (!screen) return -2;
	screen->UpdateFrameAlpha();
	const int width = screen->GetFrameWidth();
	const int height = screen->GetFrameHeight();
	// Ordinary LCD providers reserve row zero for status sprites. Match the
	// existing web frontend by exposing only the dot-matrix rows to the host.
	const int source_start_row = g_emulator->hardware_id == casioemu::HW_EPS6009 ? 0 : 1;
	const int display_height = std::max(0, height - source_start_row);
	g_frame_width = width;
	g_frame_height = display_height;
	g_had_status_row = source_start_row == 1;
	std::vector<uint8_t> source(static_cast<size_t>(width) * static_cast<size_t>(height) * 4);
	screen->WriteFrameRgba(source.data(), g_display_r, g_display_g, g_display_b);
	g_frame_rgba.resize(static_cast<size_t>(width) * static_cast<size_t>(display_height) * 4);
	for (int y = 0; y < display_height; ++y) {
		const uint8_t* src =
			source.data() + (static_cast<size_t>(y + source_start_row) * width * 4);
		uint8_t* dst = g_frame_rgba.data() + static_cast<size_t>(y) * width * 4;
		std::memcpy(dst, src, static_cast<size_t>(width) * 4);
	}
	const int status_count = std::max(0, screen->GetStatusAlphaCount());
	g_status_alpha.resize(static_cast<size_t>(status_count));
	if (status_count > 0) screen->WriteStatusAlpha(g_status_alpha.data(), status_count);
	return 0;
}

int ce_frame_has_status_row() { return g_had_status_row ? 1 : 0; }

void ce_set_display_color(int r, int g, int b) {
	g_display_r = std::clamp(r, 0, 255);
	g_display_g = std::clamp(g, 0, 255);
	g_display_b = std::clamp(b, 0, 255);
}

uint32_t ce_frame_ptr() {
	return g_frame_rgba.empty() ? 0 : static_cast<uint32_t>(reinterpret_cast<uintptr_t>(g_frame_rgba.data()));
}

int ce_frame_width() { return g_frame_width; }
int ce_frame_height() { return g_frame_height; }
uint32_t ce_status_alpha_ptr() {
	return g_status_alpha.empty() ? 0 : static_cast<uint32_t>(reinterpret_cast<uintptr_t>(g_status_alpha.data()));
}
int ce_status_alpha_len() { return static_cast<int>(g_status_alpha.size()); }
int ce_is_running() { return g_emulator && g_emulator->Running() ? 1 : 0; }
int ce_is_paused() { return g_emulator && g_emulator->GetPaused() ? 1 : 0; }

int ce_set_key(int kiko, int pressed) {
	auto* keyboard = Keyboard();
	if (!keyboard) return -1;
	if (kiko < 0 || kiko > 0xFF) return -2;
	keyboard->PressCode(static_cast<uint8_t>(kiko), pressed != 0);
	return 0;
}

void ce_release_all() {
	if (auto* keyboard = Keyboard()) keyboard->ReleaseAll();
}

int ce_bind_key(int keycode, int kiko) {
	auto* keyboard = Keyboard();
	if (!keyboard) return -1;
	if (kiko < 0 || kiko > 0xFF) return -2;
	keyboard->BindKeycode(keycode, static_cast<uint8_t>(kiko));
	return 0;
}

int ce_unbind_key(int keycode) {
	auto* keyboard = Keyboard();
	if (!keyboard) return -1;
	keyboard->UnbindKeycode(keycode);
	return 0;
}

int ce_handle_key(int keycode, int pressed) {
	auto* keyboard = Keyboard();
	if (!keyboard) return -1;
	keyboard->HandleKeycode(keycode, pressed != 0);
	return 0;
}

int ce_read_memory(uint32_t address, int length, uint8_t* out) {
	if (!g_emulator || !out || length < 0) return -1;
	if (length > kMaxTextResult) return -2;
	for (int i = 0; i < length; ++i) {
		if (auto* core = g_emulator->chipset.t4x)
			out[i] = core->ReadDebugMemory(address + static_cast<uint32_t>(i));
		else if (auto* eps = g_emulator->chipset.epscpu)
			out[i] = eps->ReadDebugMemory(address + static_cast<uint32_t>(i));
		else
			out[i] = g_emulator->chipset.mmu.ReadData(address + static_cast<size_t>(i));
	}
	return length;
}

int ce_write_memory(uint32_t address, const uint8_t* data, int length) {
	if (!g_emulator || !data || length < 0) return -1;
	if (length > kMaxTextResult) return -2;
	if (!g_emulator->GetPaused()) return -3;
	for (int i = 0; i < length; ++i) {
		if (auto* core = g_emulator->chipset.t4x)
			core->WriteDebugMemory(address + static_cast<uint32_t>(i), data[i]);
		else if (auto* eps = g_emulator->chipset.epscpu)
			eps->WriteDebugMemory(address + static_cast<uint32_t>(i), data[i]);
		else
			g_emulator->chipset.mmu.WriteData(address + static_cast<size_t>(i), data[i]);
	}
	return length;
}

uint32_t ce_pc() {
	return CurrentPc();
}

const char* ce_registers_json() {
	if (!g_emulator) return "{}";
	std::ostringstream out;
	out << "{";
	bool first = true;
	auto add = [&](const char* name, uint32_t value) {
		if (!first) out << ",";
		first = false;
		out << "\"" << name << "\":" << value;
	};
	if (auto* core = g_emulator->chipset.t4x) {
		const auto state = core->Snapshot();
		add("pc", state.pc);
		for (unsigned i = 0; i < state.reg.size(); ++i) {
			char name[16];
			std::snprintf(name, sizeof(name), "r%u", i);
			add(name, state.reg[i]);
		}
	}
	else if (auto* eps = g_emulator->chipset.epscpu) {
		const auto snapshot = eps->DebugSnapshot();
		add("pc", snapshot.program_counter);
		add("sp", snapshot.stack_pointer);
		for (uint32_t i = 0; i < snapshot.registers.size(); ++i) {
			char name[16];
			std::snprintf(name, sizeof(name), "r%u", i);
			add(name, snapshot.registers[i]);
		}
	}
	else {
		const auto& cpu = g_emulator->chipset.cpu;
		add("pc", (static_cast<uint32_t>(cpu.reg_csr.raw) << 16) | cpu.reg_pc.raw);
		add("sp", cpu.reg_sp.raw);
		add("psw", cpu.reg_psw.raw);
		add("dsr", cpu.reg_dsr.raw);
		for (unsigned i = 0; i < 16; ++i) {
			char name[16];
			std::snprintf(name, sizeof(name), "r%u", i);
			add(name, cpu.reg_r[i].raw);
		}
	}
	out << "}";
	g_text_result = out.str();
	return g_text_result.c_str();
}

const char* ce_backtrace() {
	if (!g_emulator) return "";
	if (auto* core = g_emulator->chipset.t4x) g_text_result = core->GetBacktrace();
	else if (auto* eps = g_emulator->chipset.epscpu) g_text_result = eps->GetBacktrace();
	else g_text_result = g_emulator->chipset.cpu.GetBacktrace();
	return g_text_result.c_str();
}

const char* ce_disassemble(uint32_t address, int count) {
	if (!g_emulator || count < 0) return "[]";
	std::ostringstream out;
	out << "[";
	uint32_t current = address;
	for (int i = 0; i < count; ++i) {
		int consumed = 2;
		std::string text;
		if (auto* core = g_emulator->chipset.t4x) {
			text = core->Disassemble(static_cast<uint16_t>(current));
			consumed = 2;
		}
		else if (g_emulator->chipset.epscpu) {
			text = DecodeEps(current, &consumed);
		}
		else {
			text = DecodeU8(current, &consumed);
		}
		if (i) out << ",";
		out << "{\"address\":" << current << ",\"bytes\":\"";
		for (int b = 0; b < consumed; ++b) {
			char hex[4];
			std::snprintf(hex, sizeof(hex), "%02X", g_emulator->chipset.mmu.ReadCode(current + b));
			out << hex;
		}
		out << "\",\"text\":\"";
		for (char ch : text) {
			if (ch == '"' || ch == '\\') out << '\\';
			if (ch == '\n') out << "\\n";
			else if (ch >= 32) out << ch;
		}
		out << "\"}";
		current += static_cast<uint32_t>(consumed);
	}
	out << "]";
	g_text_result = out.str();
	return g_text_result.c_str();
}

int ce_add_execution_breakpoint(uint32_t address) {
	if (!g_emulator) return -1;
	if (auto* core = g_emulator->chipset.t4x) {
		casioemu::ExecutionBreakpoint bp{};
		bp.address = address;
		bp.enabled = true;
		if (!core->ConfigureExecutionBreakpoint(bp)) return -2;
	}
	else if (auto* eps = g_emulator->chipset.epscpu) {
		casioemu::ExecutionBreakpoint bp{};
		bp.address = address;
		bp.enabled = true;
		if (!eps->ConfigureExecutionBreakpoint(bp)) return -2;
	}
	else {
		return -3;
	}
	SyncBreakpointCache();
	return 0;
}

int ce_remove_execution_breakpoint(uint32_t address) {
	if (!g_emulator) return -1;
	if (auto* core = g_emulator->chipset.t4x) core->RemoveExecutionBreakpoint(address);
	else if (auto* eps = g_emulator->chipset.epscpu) eps->RemoveExecutionBreakpoint(address);
	else return -2;
	SyncBreakpointCache();
	return 0;
}

int ce_add_memory_breakpoint(uint32_t address, int write, int compare_data, uint32_t data, uint32_t mask, uint32_t skip_count) {
	if (!g_emulator) return -1;
	casioemu::MemoryBreakpoint bp{};
	bp.address = address;
	bp.write = write != 0;
	bp.enabled = true;
	bp.break_when_hit = true;
	bp.compare_data = compare_data != 0;
	bp.data = static_cast<uint8_t>(data & 0xff);
	bp.mask = static_cast<uint8_t>(mask & 0xff);
	bp.skip_count = skip_count;
	bool added = false;
	if (auto* core = g_emulator->chipset.t4x) added = core->AddMemoryBreakpoint(bp);
	else if (auto* eps = g_emulator->chipset.epscpu) added = eps->AddMemoryBreakpoint(bp);
	if (!added) return -2;
	SyncBreakpointCache();
	return 0;
}

int ce_remove_memory_breakpoint(uint32_t address, int write) {
	if (!g_emulator) return -1;
	bool removed = false;
	if (auto* core = g_emulator->chipset.t4x) removed = core->RemoveMemoryBreakpoint(address, write != 0);
	else if (auto* eps = g_emulator->chipset.epscpu) removed = eps->RemoveMemoryBreakpoint(address, write != 0);
	else return -2;
	if (!removed) return -3;
	SyncBreakpointCache();
	return 0;
}

const char* ce_breakpoints_json() {
	SyncBreakpointCache();
	std::ostringstream out;
	out << "{\"execution\":[";
	for (size_t i = 0; i < g_execution_breakpoints.size(); ++i) {
		if (i) out << ",";
		out << g_execution_breakpoints[i].address;
	}
	out << "],\"memory\":[";
	for (size_t i = 0; i < g_memory_breakpoints.size(); ++i) {
		const auto& bp = g_memory_breakpoints[i];
		if (i) out << ",";
		out << "{\"address\":" << bp.address << ",\"write\":" << (bp.write ? "true" : "false")
			<< ",\"enabled\":" << (bp.enabled ? "true" : "false")
			<< ",\"hitCount\":" << bp.hit_count << "}";
	}
	out << "]}";
	g_text_result = out.str();
	return g_text_result.c_str();
}

int ce_step_into() {
	return RunNativeStep(casioemu::DebugStopReason::Step) ? 0 : -2;
}

int ce_step_over() {
	return RunNativeStep(casioemu::DebugStopReason::StepOver) ? 0 : -2;
}

int ce_step_out() {
	if (!g_emulator) return -1;
	if (!g_emulator->chipset.t4x && !g_emulator->chipset.epscpu) return -3;
	return RunNativeStep(casioemu::DebugStopReason::StepOut) ? 0 : -2;
}

int ce_continue() {
	if (!g_emulator) return -1;
	if (auto* core = g_emulator->chipset.t4x) core->RequestContinue();
	else if (auto* eps = g_emulator->chipset.epscpu) eps->RequestContinue();
	g_emulator->SetPaused(false);
	ResetClock();
	return 0;
}

int ce_run_to(uint32_t address) {
	if (!g_emulator) return -1;
	if (auto* core = g_emulator->chipset.t4x) core->RequestRunToAddress(static_cast<uint16_t>(address));
	else if (auto* eps = g_emulator->chipset.epscpu) eps->RequestRunToAddress(address);
	else return -2;
	g_emulator->SetPaused(false);
	ResetClock();
	return 0;
}

const char* ce_stop_reason() {
	if (!g_emulator) return "none";
	if (auto* core = g_emulator->chipset.t4x) return StopReasonName(core->LastDebugStop().reason);
	if (auto* eps = g_emulator->chipset.epscpu) return StopReasonName(eps->LastDebugStop().reason);
	return "none";
}

uint32_t ce_snapshot_ptr() {
	return g_snapshot.empty() ? 0 : static_cast<uint32_t>(reinterpret_cast<uintptr_t>(g_snapshot.data()));
}
int ce_snapshot_len() { return static_cast<int>(g_snapshot.size()); }

int ce_save_snapshot() {
	if (!g_emulator) return -1;
	try {
		std::ostringstream state(std::ios::out | std::ios::binary);
		g_emulator->SetPaused(true);
		g_emulator->chipset.SaveStateAll(state);
		const std::string raw = state.str();
		const auto compressed = Compress::Deflate(
			reinterpret_cast<const uint8_t*>(raw.data()), raw.size());
		g_snapshot.clear();
		g_snapshot.reserve(8 + compressed.size());
		const uint64_t raw_size = raw.size();
		for (int i = 0; i < 8; ++i)
			g_snapshot.push_back(static_cast<uint8_t>(raw_size >> (i * 8)));
		g_snapshot.insert(g_snapshot.end(), compressed.begin(), compressed.end());
		return 0;
	}
	catch (const std::exception& error) {
		SetError(error.what());
		g_snapshot.clear();
		return -2;
	}
}

int ce_restore_snapshot(const uint8_t* data, int length) {
	if (!g_emulator || !data || length <= 8 || length > kMaxSnapshotBytes) return -1;
	try {
		uint64_t raw_size = 0;
		for (int i = 0; i < 8; ++i) raw_size |= static_cast<uint64_t>(data[i]) << (i * 8);
		if (raw_size > static_cast<uint64_t>(kMaxSnapshotBytes)) return -2;
		const auto raw = Compress::Inflate(data + 8, static_cast<size_t>(length - 8), raw_size);
		std::istringstream state(
			std::string(reinterpret_cast<const char*>(raw.data()), raw.size()),
			std::ios::in | std::ios::binary);
		g_emulator->SetPaused(true);
		g_emulator->chipset.LoadStateAll(state);
		ClearFrame();
		ResetClock();
		return 0;
	}
	catch (const std::exception& error) {
		SetError(error.what());
		return -3;
	}
}

int ce_save_persistent(uint8_t* out, int capacity) {
	if (!g_emulator || capacity < 0) return -1;
	try {
		const auto payload = PersistentPayload();
		if (payload.empty()) return -2;
		constexpr std::array<uint8_t, 8> kMagic{{'C', 'E', 'W', 'P', 'E', 'R', 'S', '1'}};
		std::vector<uint8_t> blob;
		blob.insert(blob.end(), kMagic.begin(), kMagic.end());
		AppendLe32(blob, static_cast<uint32_t>(g_emulator->hardware_id));
		AppendLe32(blob, static_cast<uint32_t>(payload.size()));
		blob.insert(blob.end(), payload.begin(), payload.end());
		if (static_cast<int>(blob.size()) > capacity) return static_cast<int>(blob.size());
		if (!out) return static_cast<int>(blob.size());
		std::memcpy(out, blob.data(), blob.size());
		return static_cast<int>(blob.size());
	}
	catch (const std::exception& error) {
		SetError(error.what());
		return -3;
	}
}

int ce_load_persistent(const uint8_t* data, int length) {
	if (!g_emulator || !data || length < 16) return -1;
	static constexpr std::array<uint8_t, 8> kMagic{{'C', 'E', 'W', 'P', 'E', 'R', 'S', '1'}};
	if (!std::equal(kMagic.begin(), kMagic.end(), data)) return -2;
	if (LoadLe32(data + 8) != static_cast<uint32_t>(g_emulator->hardware_id)) return -3;
	const uint32_t payload_size = LoadLe32(data + 12);
	if (payload_size > static_cast<uint32_t>(kMaxSnapshotBytes) ||
		length != static_cast<int>(payload_size) + 16) return -4;
	try {
		const auto payload = std::vector<uint8_t>(data + 16, data + length);
		if (!LoadPersistentPayload(payload)) return -5;
		ClearFrame();
		ResetClock();
		return 0;
	}
	catch (const std::exception& error) {
		SetError(error.what());
		return -6;
	}
}

int ce_has_native_debugger() {
	return g_emulator && (g_emulator->chipset.t4x || g_emulator->chipset.epscpu) ? 1 : 0;
}

const char* ce_last_error() {
	return g_last_error.c_str();
}

int ce_model_hardware() {
	return g_emulator ? static_cast<int>(g_emulator->hardware_id) : -1;
}

}

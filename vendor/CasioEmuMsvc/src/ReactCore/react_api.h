#pragma once
#include <cstdint>

#ifdef __cplusplus
extern "C" {
#endif

int ce_begin_model(void);
int ce_add_resource(const char* path, const uint8_t* data, int length);
int ce_load_model(void);
const char* ce_model_info_json(void);
void ce_shutdown(void);

int ce_start(void);
int ce_pause(int paused);
int ce_reset(void);
int ce_tick_frame(void);
int ce_frame_has_status_row(void);
void ce_set_display_color(int r, int g, int b);
uint32_t ce_frame_ptr(void);
int ce_frame_width(void);
int ce_frame_height(void);
uint32_t ce_status_alpha_ptr(void);
int ce_status_alpha_len(void);
int ce_is_running(void);
int ce_is_paused(void);

int ce_set_key(int kiko, int pressed);
void ce_release_all(void);
int ce_bind_key(int keycode, int kiko);
int ce_handle_key(int keycode, int pressed);

int ce_read_memory(uint32_t address, int length, uint8_t* out);
int ce_write_memory(uint32_t address, const uint8_t* data, int length);
uint32_t ce_pc(void);
const char* ce_registers_json(void);
const char* ce_backtrace(void);
const char* ce_disassemble(uint32_t address, int count);

int ce_add_execution_breakpoint(uint32_t address);
int ce_remove_execution_breakpoint(uint32_t address);
int ce_add_memory_breakpoint(uint32_t address, int write, int compare_data,
	uint32_t data, uint32_t mask, uint32_t skip_count);
int ce_remove_memory_breakpoint(uint32_t address, int write);
const char* ce_breakpoints_json(void);

int ce_step_into(void);
int ce_step_over(void);
int ce_step_out(void);
int ce_continue(void);
int ce_run_to(uint32_t address);
const char* ce_stop_reason(void);

uint32_t ce_snapshot_ptr(void);
int ce_snapshot_len(void);
int ce_save_snapshot(void);
int ce_restore_snapshot(const uint8_t* data, int length);

int ce_save_persistent(uint8_t* out, int capacity);
int ce_load_persistent(const uint8_t* data, int length);
int ce_has_native_debugger(void);
const char* ce_last_error(void);
int ce_model_hardware(void);

#ifdef __cplusplus
}
#endif

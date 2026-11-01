/* Synthetic DWARF-4 aggregate fixture; no proprietary firmware.
 * Rebuild using GCC (Linux):
 *   gcc -g -gdwarf-4 -fno-eliminate-unused-debug-types -O0 -c -o layout.o layout.c
 *   ld -o layout.elf -e 0 layout.o
 *   objcopy --remove-section=.data --remove-section=.comment --remove-section=.debug_aranges --remove-section=.symtab --remove-section=.strtab layout.elf
 */
typedef unsigned short word_t;

union SensorValue {
    unsigned int raw;
    float physical;
};

struct Channel {
    unsigned char enabled;
    union SensorValue reading;
};

struct Module {
    struct Channel channels[2];
    word_t status;
};

struct Module module_state = {
    .channels = { {1, {.raw = 11}}, {1, {.raw = 22}} }, .status = 5
};
struct Module *module_ptr = &module_state;
union SensorValue standalone_value = { .raw = 42 };
struct Channel channel_state = { .enabled = 1, .reading = { .physical = 88.5f } };

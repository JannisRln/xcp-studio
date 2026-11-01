/* Synthetic ECU-like metadata fixture; no proprietary firmware.
 * Rebuild: gcc -g -gdwarf-4 -fno-eliminate-unused-debug-types -O0 -c -o engine.o engine.c
 * Strip: objcopy --strip-debug engine.o engine-stripped.o
 */
typedef unsigned int rpm_t;
enum Mode { MODE_OFF = 0, MODE_RUN = 1 };
struct Engine {
    rpm_t rpm;
    float coolant;
    enum Mode mode;
};
struct Engine engine = { 1850u, 88.5f, MODE_RUN };
struct Engine *engine_ptr = &engine;
unsigned char samples[3] = { 1, 2, 3 };

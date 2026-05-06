#pragma once

#include <napi.h>
#include <atomic>
#include <memory>
#include <thread>
#include <wayland-client.h>

struct wl_seat;
struct ext_idle_notifier_v1;
struct ext_idle_notification_v1;

class IdleNotifier : public Napi::ObjectWrap<IdleNotifier> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    IdleNotifier(const Napi::CallbackInfo& info);

    Napi::Value IsIdle(const Napi::CallbackInfo& info);


    // Static wrapper for Wayland C callbacks
    static void registryGlobal(void* data, wl_registry* registry, uint32_t name, const char* interface, uint32_t version);
    static void registryGlobalRemove(void* data, wl_registry* registry, uint32_t name);
    static void idleNotificationIdled(void* data, ext_idle_notification_v1*);
    static void idleNotificationResumed(void* data, ext_idle_notification_v1*);
private:
    void runEventLoop();
    void handleIdled();
    void handleResumed();

    std::atomic<bool> running_{true};
    std::shared_ptr<std::atomic<bool>> is_idle_;
    Napi::ThreadSafeFunction on_idled_;
    Napi::ThreadSafeFunction on_resumed_;

    wl_display* display_ = nullptr;
    wl_registry* registry_ = nullptr;
    wl_seat* seat_ = nullptr;
    ext_idle_notifier_v1* notifier_ = nullptr;
    ext_idle_notification_v1* notification_ = nullptr;
    std::thread event_thread_;
};

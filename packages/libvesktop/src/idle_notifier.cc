#include <stdexcept>
#include <cstring>

#include "idle_notifier.hh"
#include "ext-idle-notify-v1-client-protocol.h"

void IdleNotifier::registryGlobal(void* data, wl_registry* registry, uint32_t name, const char* interface, uint32_t version) {
    auto* self = static_cast<IdleNotifier*>(data);

    if (strcmp(interface, wl_seat_interface.name) == 0) {
        self->seat_ = static_cast<wl_seat*>(wl_registry_bind(registry, name, &wl_seat_interface, std::min(version, 1u)));
    } else if (strcmp(interface, ext_idle_notifier_v1_interface.name) == 0) {
        self->notifier_ = static_cast<ext_idle_notifier_v1*>(wl_registry_bind(registry, name, &ext_idle_notifier_v1_interface, 1));
    }
}

void IdleNotifier::registryGlobalRemove(void*, wl_registry*, uint32_t) {}

static const wl_registry_listener registry_listener = {
    IdleNotifier::registryGlobal,
    IdleNotifier::registryGlobalRemove
};

void IdleNotifier::idleNotificationIdled(void* data, ext_idle_notification_v1*) {
    auto* self = static_cast<IdleNotifier*>(data);
    self->handleIdled();
}

void IdleNotifier::idleNotificationResumed(void* data, ext_idle_notification_v1*) {
    auto* self = static_cast<IdleNotifier*>(data);
    self->handleResumed();
}

static const ext_idle_notification_v1_listener idle_listener = {
    IdleNotifier::idleNotificationIdled,
    IdleNotifier::idleNotificationResumed
};

void IdleNotifier::handleIdled() {
    is_idle_->store(true, std::memory_order_seq_cst);

    if (on_idled_) {
        on_idled_.BlockingCall([](Napi::Env env, Napi::Function jsCallback){
            jsCallback.Call({});
        });
    }
}

void IdleNotifier::handleResumed() {
    is_idle_->store(false, std::memory_order_seq_cst);

    if (on_resumed_) {
        on_resumed_.BlockingCall([](Napi::Env env, Napi::Function jsCallback){
            jsCallback.Call({});
        });
    }
}

Napi::Object IdleNotifier::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "IdleNotifier", {
        IdleNotifier::InstanceMethod("isIdle", &IdleNotifier::IsIdle)
    });

    exports.Set("IdleNotifier", func);

    return exports;
}

IdleNotifier::IdleNotifier(const Napi::CallbackInfo& info) : Napi::ObjectWrap<IdleNotifier>(info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Expected an options object").ThrowAsJavaScriptException();
        return;
    }

    Napi::Object options = info[0].As<Napi::Object>();

    if (!options.Has("timeoutMs") || !options.Get("timeoutMs").IsNumber()) {
        Napi::TypeError::New(env, "options.timeoutMs must be a number").ThrowAsJavaScriptException();
        return;
    }
    int timeout_ms = options.Get("timeoutMs").As<Napi::Number>().Int32Value();

    is_idle_ = std::make_shared<std::atomic<bool>>(false);

    Napi::Value onIdledVal = options.Get("onIdled");
    if (onIdledVal.IsFunction()) {
        on_idled_ = Napi::ThreadSafeFunction::New(env, onIdledVal.As<Napi::Function>(), "onIdled", 0, 1);
        on_idled_.Unref(env);
    }

    Napi::Value onResumedVal = options.Get("onResumed");
    if (onResumedVal.IsFunction()) {
        on_resumed_ = Napi::ThreadSafeFunction::New(env, onResumedVal.As<Napi::Function>(), "onResumed", 0, 1);
        on_resumed_.Unref(env);
    }

    display_ = wl_display_connect(nullptr);
    if (!display_) throw std::runtime_error("Failed to connect to Wayland display");

    registry_ = wl_display_get_registry(display_);
    wl_registry_add_listener(registry_, &registry_listener, this);
    wl_display_roundtrip(display_);

    if (!seat_) throw std::runtime_error("wl_seat not found");
    if (!notifier_) throw std::runtime_error("ext_idle_notifier_v1 not supported");

    notification_ = ext_idle_notifier_v1_get_idle_notification(notifier_, timeout_ms, seat_);
    ext_idle_notification_v1_add_listener(notification_, &idle_listener, this);

    running_.store(true);
    event_thread_ = std::thread(&IdleNotifier::runEventLoop, this);
}

void IdleNotifier::runEventLoop() {
    while (running_.load()) {
        wl_display_dispatch_pending(display_);
        if (wl_display_flush(display_) < 0) break;

        wl_display_dispatch(display_);
    }
}

Napi::Value IdleNotifier::IsIdle(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), is_idle_->load(std::memory_order_seq_cst));
}

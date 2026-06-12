#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <gio/gio.h>
#include <iostream>
#include <memory>
#include <napi.h>
#include <optional>
#include <thread>

template <typename T> struct GObjectDeleter {
  void operator()(T *obj) const {
    if (obj)
      g_object_unref(obj);
  }
};

template <typename T> using GObjectPtr = std::unique_ptr<T, GObjectDeleter<T>>;

struct GVariantDeleter {
  void operator()(GVariant *variant) const {
    if (variant)
      g_variant_unref(variant);
  }
};

using GVariantPtr = std::unique_ptr<GVariant, GVariantDeleter>;

struct GErrorDeleter {
  void operator()(GError *error) const {
    if (error)
      g_error_free(error);
  }
};

using GErrorPtr = std::unique_ptr<GError, GErrorDeleter>;

struct SignalSubscription {
  SignalSubscription() = default;
  SignalSubscription(GDBusConnection *conn, guint id) : conn_(conn), id_(id) {}
  ~SignalSubscription() { reset(); }

  SignalSubscription(const SignalSubscription &) = delete;
  SignalSubscription &operator=(const SignalSubscription &) = delete;

  SignalSubscription(SignalSubscription &&o) noexcept : conn_(o.conn_), id_(o.id_) { o.id_ = 0; }
  SignalSubscription &operator=(SignalSubscription &&o) noexcept {
    if (this != &o) { reset(); conn_ = o.conn_; id_ = o.id_; o.id_ = 0; }
    return *this;
  }

  void reset() {
    if (id_) { g_dbus_connection_signal_unsubscribe(conn_, id_); id_ = 0; }}
  explicit operator bool() const { return id_ != 0; }

private:
  GDBusConnection *conn_ = nullptr;
  guint id_ = 0;
};

bool update_launcher_count(int count) {
  GError *error = nullptr;

  const char *chromeDesktop = std::getenv("CHROME_DESKTOP");
  const char *isFlatpak = std::getenv("FLATPAK_ID");
  std::string desktop_id = std::string("application://") +
                           (chromeDesktop ? chromeDesktop : isFlatpak ? "dev.vencord.Vesktop.desktop" : "vesktop.desktop");

  GObjectPtr<GDBusConnection> bus(
      g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, &error));
  if (!bus) {
    GErrorPtr error_ptr(error);
    std::cerr << "[libvesktop::update_launcher_count] Failed to connect to "
                 "session bus: "
              << (error_ptr ? error_ptr->message : "unknown error")
              << std::endl;
    return false;
  }

  GVariantBuilder builder = G_VARIANT_BUILDER_INIT(G_VARIANT_TYPE("a{sv}"));
  g_variant_builder_add(&builder, "{sv}", "count", g_variant_new_int64(count));
  g_variant_builder_add(&builder, "{sv}", "count-visible",
                        g_variant_new_boolean(count != 0));

  gboolean result = g_dbus_connection_emit_signal(
      bus.get(), nullptr, "/", "com.canonical.Unity.LauncherEntry", "Update",
      g_variant_new("(sa{sv})", desktop_id.c_str(), &builder), &error);

  if (!result || error) {
    GErrorPtr error_ptr(error);
    std::cerr
        << "[libvesktop::update_launcher_count] Failed to emit Update signal: "
        << (error_ptr ? error_ptr->message : "unknown error") << std::endl;
    return false;
  }

  return true;
}

bool request_background(bool autostart, const std::vector<std::string> &commandline) {
  GError *error = nullptr;

  GObjectPtr<GDBusConnection> bus(
      g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, &error));
  if (!bus) {
    GErrorPtr error_ptr(error);
    std::cerr
        << "[libvesktop::request_background] Failed to connect to session bus: "
        << (error_ptr ? error_ptr->message : "unknown error") << std::endl;
    return false;
  }

  GVariantBuilder builder = G_VARIANT_BUILDER_INIT(G_VARIANT_TYPE("a{sv}"));
  g_variant_builder_add(&builder, "{sv}", "autostart",
                        g_variant_new_boolean(autostart));

  if (!commandline.empty()) {
    GVariantBuilder cmd_builder = G_VARIANT_BUILDER_INIT(G_VARIANT_TYPE("as"));
    for (const auto &s : commandline)
      g_variant_builder_add(&cmd_builder, "s", s.c_str());
    g_variant_builder_add(&builder, "{sv}", "commandline",
                          g_variant_builder_end(&cmd_builder));
  }

  GVariantPtr reply(g_dbus_connection_call_sync(
      bus.get(), "org.freedesktop.portal.Desktop",
      "/org/freedesktop/portal/desktop", "org.freedesktop.portal.Background",
      "RequestBackground", g_variant_new("(sa{sv})", "", &builder), nullptr,
      G_DBUS_CALL_FLAGS_NONE, 5000, nullptr, &error));

  if (!reply) {
    GErrorPtr error_ptr(error);
    std::cerr
        << "[libvesktop::request_background] Failed to call RequestBackground: "
        << (error_ptr ? error_ptr->message : "unknown error") << std::endl;
    return false;
  }

  return true;
}

Napi::Value updateUnityLauncherCount(Napi::CallbackInfo const &info) {
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(info.Env(), "Expected (number)")
        .ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }

  int count = info[0].As<Napi::Number>().Int32Value();
  bool success = update_launcher_count(count);
  return Napi::Boolean::New(info.Env(), success);
}

Napi::Value RequestBackground(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsBoolean() || !info[1].IsArray()) {
    Napi::TypeError::New(env, "Expected (boolean, string[])")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  bool autostart = info[0].As<Napi::Boolean>();
  auto arr = info[1].As<Napi::Array>();
  std::vector<std::string> commandline;
  for (uint32_t i = 0; i < arr.Length(); i++) {
    Napi::Value v = arr.Get(i);
    if (v.IsString())
      commandline.push_back(v.As<Napi::String>().Utf8Value());
  }

  bool ok = request_background(autostart, commandline);
  return Napi::Boolean::New(env, ok);
}

class XDPGlobalShortcuts : public Napi::ObjectWrap<XDPGlobalShortcuts> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("XDPGlobalShortcuts", DefineClass(env, "XDPGlobalShortcuts", {
      InstanceMethod("bindShortcuts", &XDPGlobalShortcuts::BindShortcuts),
      InstanceMethod("configureShortcuts", &XDPGlobalShortcuts::Configure),
      InstanceMethod("destroy",       &XDPGlobalShortcuts::Destroy),
    }));
    return exports;
  }

  // CreateSession on `new XDPGlobalShortcuts()`
  XDPGlobalShortcuts(const Napi::CallbackInfo &info) : ObjectWrap(info) {
    Napi::Env env = info.Env();
    emitterRef_ = Napi::Persistent(info[0].As<Napi::Object>());

    GError *error = nullptr;
    connection_.reset(g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, &error));
    if (!connection_) {
      const GErrorPtr err(error);
      Napi::Error::New(env, err ? err->message : "Failed to connect to session bus")
        .ThrowAsJavaScriptException();
      return;
    }
    const char *unique = g_dbus_connection_get_unique_name(connection_.get());
    connectionName_ = (unique && *unique == ':') ? unique + 1 : (unique ? unique : "");
    std::ranges::replace(connectionName_, '.', '_');

    // loop_ = g_main_loop_new(nullptr, FALSE); //electron has its own loop
    // running glibThread_ = std::thread([this] { g_main_loop_run(loop_); });
    tsfn_ = Napi::ThreadSafeFunction::New( env, Napi::Function::New(env, [](const Napi::CallbackInfo &) {}),
      "dbus-events", 0, 1);

    CreateSession();
  }

  ~XDPGlobalShortcuts() { Cleanup(); }

  Napi::Value Destroy(const Napi::CallbackInfo &info) {
    Cleanup();
    return info.Env().Undefined();
  }
  Napi::Value BindShortcuts(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsArray()) {
      Napi::TypeError::New(env, "Expected (array)").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    if (sessionHandle_.empty()) {
      Napi::Error::New(env, "Session not ready yet").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    const std::string token = generate_token();

    GVariantBuilder shortcuts_builder = G_VARIANT_BUILDER_INIT(G_VARIANT_TYPE("a(sa{sv})"));
    auto arr = info[0].As<Napi::Array>();
    for (uint32_t i = 0; i < arr.Length(); i++) {
      auto item = arr.Get(i).As<Napi::Object>();
      GVariantBuilder builder = G_VARIANT_BUILDER_INIT(G_VARIANT_TYPE_VARDICT);
      g_variant_builder_add(&builder, "{sv}", "description",
          g_variant_new_string(item.Get("description").As<Napi::String>().Utf8Value().c_str()));
      if (item.Has("preferred_trigger"))
        g_variant_builder_add(&builder, "{sv}", "preferred_trigger",
            g_variant_new_string(item.Get("preferred_trigger").As<Napi::String>().Utf8Value().c_str()));
      g_variant_builder_add(&shortcuts_builder, "(sa{sv})",
          item.Get("id").As<Napi::String>().Utf8Value().c_str(), &builder);
    }

    bindSignal_ = SubscribeResponse(token, [this](GVariant *parameters) {
      bindSignal_.reset();
      guint response = 0;
      GVariant *results_raw = nullptr;
      g_variant_get(parameters, "(u@a{sv})", &response, &results_raw);
      GVariantPtr results(results_raw);
      if (response == 2) { // 0 Success | 1 User cancelled so still listen to signals
        EmitEvent("error", "BindShortcuts: portal returned response " + std::to_string(response));
        return;
      }
      const GVariantPtr shortcuts(g_variant_lookup_value(
          results.get(), "shortcuts", G_VARIANT_TYPE("a(sa{sv})")));
      EmitEvent("shortcutsBound", { ParseShortcuts(shortcuts.get()) });
      SubscribePressedSignals();
    });

    GVariantBuilder options = G_VARIANT_BUILDER_INIT(G_VARIANT_TYPE_VARDICT);
    g_variant_builder_add(&options, "{sv}", "handle_token", g_variant_new_string(token.c_str()));

    CallPortalMethod("BindShortcuts",
        g_variant_new("(oa(sa{sv})sa{sv})", sessionHandle_.c_str(), &shortcuts_builder, "", &options),
        G_VARIANT_TYPE("(o)"), OnError(&bindSignal_));

    return env.Undefined();
  }

  Napi::Value Configure(const Napi::CallbackInfo &info) {
    GVariantBuilder options = G_VARIANT_BUILDER_INIT(G_VARIANT_TYPE_VARDICT);
    CallPortalMethod("ConfigureShortcuts",
        g_variant_new("(osa{sv})", sessionHandle_.c_str(), "", &options),
        G_VARIANT_TYPE("(o)"), OnError(nullptr, "error"));
    return info.Env().Undefined();
  }

private:
  using ReplyCallback = std::function<void(GVariantPtr, GErrorPtr)>;

  struct SignalCtx {
    std::function<void(GVariant *)> fn;
    static void invoke(GDBusConnection *, const char *, const char *, const char *,
                       const char *, GVariant *params, gpointer ud) {
      static_cast<SignalCtx *>(ud)->fn(params);
    }
    static void destroy(gpointer ud) { delete static_cast<SignalCtx *>(ud); }
  };

  void CallMethod(const char *interface, const char *method, GVariant *params, const GVariantType *replyType, ReplyCallback callback) {
    struct Ctx { ReplyCallback fn; };
    g_dbus_connection_call(
        connection_.get(), "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        interface, method, params, replyType,
        G_DBUS_CALL_FLAGS_NONE, -1, nullptr,
        [](GObject *src, GAsyncResult *res, gpointer ud) {
          auto *ctx = static_cast<Ctx *>(ud);
          GError *error = nullptr;
          GVariantPtr reply(g_dbus_connection_call_finish(G_DBUS_CONNECTION(src), res, &error));
          ctx->fn(std::move(reply), GErrorPtr(error));
          delete ctx;
        },
        new Ctx{std::move(callback)});
  }

  void CallPortalMethod(const char *method, GVariant *params, const GVariantType *replyType, ReplyCallback callback) {
    CallMethod("org.freedesktop.portal.GlobalShortcuts", method, params, replyType, std::move(callback));
  }

  ReplyCallback OnError(SignalSubscription *signal, std::string event = "fatal") {
    return [this, signal, event = std::move(event)](GVariantPtr, GErrorPtr err) {
      if (!err) return;
      if (signal) signal->reset();
      EmitEvent(event, err->message);
    };
  }
  SignalSubscription SubscribeResponse(const std::string &token, std::function<void(GVariant *)> callback) {
    return { connection_.get(),
      g_dbus_connection_signal_subscribe(
          connection_.get(), "org.freedesktop.portal.Desktop",
          "org.freedesktop.portal.Request", "Response",
          make_handle_path(token).c_str(), nullptr,
          G_DBUS_SIGNAL_FLAGS_NO_MATCH_RULE,
          SignalCtx::invoke, new SignalCtx{std::move(callback)}, SignalCtx::destroy)
    };
  }
  SignalSubscription SubscribeGSSignal(const char *signal,
                                       std::function<void(GVariant *)> callback) {
    return { connection_.get(),
      g_dbus_connection_signal_subscribe(
          connection_.get(), "org.freedesktop.portal.Desktop",
          "org.freedesktop.portal.GlobalShortcuts", signal,
          "/org/freedesktop/portal/desktop", nullptr,
          G_DBUS_SIGNAL_FLAGS_NONE,
          SignalCtx::invoke, new SignalCtx{std::move(callback)}, SignalCtx::destroy)
    };
  }

  [[nodiscard]] static std::string generate_token() {
    std::string uuid = g_uuid_string_random();
    std::ranges::replace(uuid, '-', '_');
    return "vesktop" + uuid;
  }
  [[nodiscard]] std::string make_handle_path(const std::string &token) const {
    return "/org/freedesktop/portal/desktop/request/" + connectionName_ + "/" + token;
  }
  [[nodiscard]] static std::function<Napi::Value(Napi::Env)> ParseShortcuts(GVariant *shortcuts) {
    std::vector<std::tuple<std::string, std::string, std::string>> vec;
    if (shortcuts) {
      GVariantIter iter;
      g_variant_iter_init(&iter, shortcuts);
      const char *id = nullptr;
      GVariant *rawDict = nullptr;
      while (g_variant_iter_next(&iter, "(&s@a{sv})", &id, &rawDict)) {
        GVariantPtr vardict(rawDict);
        const char *description = nullptr, *trigger_description = nullptr;
        g_variant_lookup(vardict.get(), "description",         "&s", &description);
        g_variant_lookup(vardict.get(), "trigger_description", "&s", &trigger_description);
        vec.emplace_back(id ? id : "", description ? description : "", trigger_description ? trigger_description : "");
      }
    }
    return [data = std::move(vec)](Napi::Env env) -> Napi::Value {
      auto arr = Napi::Array::New(env, data.size());
      for (size_t i = 0; i < data.size(); ++i) {
        const auto &[id, desc, trigger] = data[i];
        auto obj = Napi::Object::New(env);
        obj.Set("id",      Napi::String::New(env, id));
        obj.Set("enabled", Napi::Boolean::New(env, true));
        obj.Set("key",     Napi::String::New(env, trigger));
        obj.Set("action",  Napi::String::New(env, id));
        arr.Set(i, obj);
      }
      return arr;
    };
  }

  void Cleanup() {
    if (cleaned_) return;
    cleaned_ = true;
    requestSignal_.reset();
    bindSignal_.reset();
    activatedSignal_.reset();
    deactivatedSignal_.reset();
    shortcutsChangedSignal_.reset();
    tsfn_.Release();
  }

  void CreateSession() {
    const std::string token = generate_token();

    requestSignal_ = SubscribeResponse(token, [this](GVariant *parameters) {
      requestSignal_.reset();
      guint response = 0;
      GVariant *results_raw = nullptr;
      g_variant_get(parameters, "(u@a{sv})", &response, &results_raw);
      GVariantPtr results(results_raw);
      if (response != 0) {
        EmitEvent("fatal", "CreateSession: portal returned response " + std::to_string(response));
        return;
      }
      gchar *handle = nullptr;
      if (!results || !g_variant_lookup(results.get(), "session_handle", "s", &handle)) {
        EmitEvent("fatal", "CreateSession: session_handle missing from response");
        return;
      }
      sessionHandle_ = handle;
      g_free(handle);
      EmitEvent("ready", sessionHandle_);
      FetchPortalVersion();
    });

    GVariantBuilder options = G_VARIANT_BUILDER_INIT(G_VARIANT_TYPE_VARDICT);
    g_variant_builder_add(&options, "{sv}", "handle_token",         g_variant_new_string(token.c_str()));
    g_variant_builder_add(&options, "{sv}", "session_handle_token", g_variant_new_string((token + "s").c_str()));

    CallPortalMethod("CreateSession", g_variant_new("(a{sv})", &options), G_VARIANT_TYPE("(o)"), OnError(&requestSignal_));
  }

  void FetchPortalVersion() {
    CallMethod("org.freedesktop.DBus.Properties", "Get",
        g_variant_new("(ss)", "org.freedesktop.portal.GlobalShortcuts", "version"),
        G_VARIANT_TYPE("(v)"),
        [this](GVariantPtr reply, GErrorPtr) {
          guint version = 0;
          if (reply) {
            GVariant *vv = nullptr;
            g_variant_get(reply.get(), "(v)", &vv);
            GVariantPtr version_variant(vv);
            version = g_variant_get_uint32(version_variant.get());
          }
          EmitEvent("portalVersion", {
            [version](Napi::Env env) -> Napi::Value { return Napi::Number::New(env, version); }
          });
        });
  }

  void SubscribePressedSignals() {
    auto subscribeKeySignal = [this](const char *signal, bool pressed) {
      return SubscribeGSSignal(signal, [this, pressed](GVariant *parameters) {
        const char *raw_id = nullptr;
        gulong timestamp = 0;
        g_variant_get(parameters, "(&o&sta{sv})", nullptr, &raw_id, &timestamp, nullptr);
        std::string id = raw_id ? raw_id : "";
        EmitEvent("shortcutEvent", {
          [id](Napi::Env env) -> Napi::Value { return Napi::String::New(env, id); },
          [pressed](Napi::Env env) -> Napi::Value { return Napi::Boolean::New(env, pressed); },
          [timestamp](Napi::Env env) -> Napi::Value { return Napi::Number::New(env, timestamp); }
        });
      });
    };

    activatedSignal_ = subscribeKeySignal("Activated", true);
    deactivatedSignal_ = subscribeKeySignal("Deactivated", false);

    shortcutsChangedSignal_ = SubscribeGSSignal("ShortcutsChanged", [this](GVariant *parameters) {
      const GVariantPtr shortcuts(g_variant_get_child_value(parameters, 1));
      EmitEvent("shortcutsBound", { ParseShortcuts(shortcuts.get()) });
    });
  }

  void EmitEvent(const std::string &eventName, std::vector<std::function<Napi::Value(Napi::Env)>> args) {
    struct EventData {
      std::string name;
      std::vector<std::function<Napi::Value(Napi::Env)>> args;
    };
    auto *data = new EventData{eventName, std::move(args)};
    tsfn_.BlockingCall(data, [this](Napi::Env env, Napi::Function, EventData *data) {
      auto emitter = emitterRef_.Value();
      auto emit = emitter.Get("emit").As<Napi::Function>();
      std::vector<Napi::Value> call_args;
      call_args.reserve(data->args.size() + 1);
      call_args.push_back(Napi::String::New(env, data->name));
      for (auto &make : data->args)
        call_args.push_back(make(env));
      emit.Call(emitter, call_args);
      if (data->name == "fatal") Cleanup();
      delete data;
    });
  }

  void EmitEvent(const std::string &eventName, const std::string &payload) {
    EmitEvent(eventName, {[payload](Napi::Env env) -> Napi::Value {
      return Napi::String::New(env, payload);
    }});
  }

  GObjectPtr<GDBusConnection> connection_;
  std::string connectionName_;
  Napi::ThreadSafeFunction tsfn_;
  Napi::ObjectReference emitterRef_;
  bool cleaned_ = false;
  std::string sessionHandle_;
  SignalSubscription requestSignal_;
  SignalSubscription bindSignal_;
  SignalSubscription activatedSignal_;
  SignalSubscription deactivatedSignal_;
  SignalSubscription shortcutsChangedSignal_;
};

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("updateUnityLauncherCount",Napi::Function::New(env, updateUnityLauncherCount));
  exports.Set("requestBackground", Napi::Function::New(env, RequestBackground));

  return XDPGlobalShortcuts::Init(env, exports);
}

NODE_API_MODULE(libvesktop, Init);

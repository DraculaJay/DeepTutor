#pragma once
#include "jarvis/worker.hpp"
#include <functional>
#include <nlohmann/json.hpp>
namespace jarvis::mac {
std::unique_ptr<IDesktopCapture> make_screen_capture();
std::unique_ptr<IAudioCapture> make_audio_tap();
void initialize_foreground_tracking();
nlohmann::json capture_sources();
std::uintptr_t foreground_id() noexcept;
bool is_game_launcher(std::uintptr_t pid) noexcept;
nlohmann::json foreground();
nlohmann::json encode_media(const VideoFrame& frame);
class HostRuntime : public IOmniRuntime {
 public:
  void load(std::string) override;
  void unload() noexcept override;
  bool ready() const noexcept override;
  InferenceResult infer(const InferenceRequest&, const std::atomic_bool&) override;
  void deliver(std::uint64_t id, std::string text);
  std::function<void(std::string)> send;
 private:
  std::atomic_bool loaded_{false};
  std::mutex mutex_;
  std::condition_variable cv_;
  std::uint64_t active_{};
  std::optional<std::string> reply_;
};
int serve(const std::string& socket_path, Worker&, HostRuntime*);
}

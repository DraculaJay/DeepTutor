#include "jarvis/macos.hpp"
#include <stdexcept>
namespace jarvis::mac {
namespace {
std::string base64(const unsigned char* bytes, std::size_t size) {
  static constexpr char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out; out.reserve((size+2)/3*4);
  for (std::size_t i=0;i<size;i+=3) {
    unsigned v=unsigned(bytes[i])<<16;
    if(i+1<size) v|=unsigned(bytes[i+1])<<8;
    if(i+2<size) v|=bytes[i+2];
    out+=alphabet[(v>>18)&63]; out+=alphabet[(v>>12)&63];
    out+=i+1<size?alphabet[(v>>6)&63]:'='; out+=i+2<size?alphabet[v&63]:'=';
  } return out;
}
}
nlohmann::json encode_media(const VideoFrame& f) {
  return {{"width",f.width},{"height",f.height},{"row_pitch",f.row_pitch},
    {"timestamp_100ns",std::to_string(f.timestamp_100ns)},{"source_id",f.source_id},
    {"bgra",base64(reinterpret_cast<const unsigned char*>(f.bgra.data()),f.bgra.size())}};
}
void HostRuntime::load(std::string) { loaded_=true; }
void HostRuntime::unload() noexcept { loaded_=false; cv_.notify_all(); }
bool HostRuntime::ready() const noexcept { return loaded_; }
void HostRuntime::deliver(std::uint64_t id,std::string text) {
  std::lock_guard lock(mutex_); if(id!=active_) return;
  reply_=std::move(text); cv_.notify_all();
}
InferenceResult HostRuntime::infer(const InferenceRequest& r,const std::atomic_bool& cancel) {
  nlohmann::json event{{"native_event","host.infer"},{"id",std::to_string(r.id)},
    {"prompt",r.prompt},{"foreground",foreground()}};
  if(r.frame) event["frame"]=encode_media(*r.frame);
  if(r.audio_16khz_mono) event["audio"]=base64(
    reinterpret_cast<const unsigned char*>(r.audio_16khz_mono->data()),r.audio_16khz_mono->size()*sizeof(float));
  {std::lock_guard lock(mutex_); active_=r.id; reply_.reset();}
  send(event.dump());
  const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(120);
  std::unique_lock lock(mutex_);
  while(loaded_ && !cancel && !reply_) {
    if(std::chrono::steady_clock::now()>=deadline) throw std::runtime_error("DeepTutor provider timed out");
    cv_.wait_for(lock,std::chrono::milliseconds(50));
  }
  return {r.id,reply_.value_or(""),cancel.load() || !loaded_};
}
}

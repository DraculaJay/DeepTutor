#include "jarvis/macos.hpp"
#include "jarvis/protocol.hpp"
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <unistd.h>
#include <csignal>
#include <cstring>
#include <iostream>
#include <limits>
namespace jarvis::mac {
namespace {
volatile sig_atomic_t stopping=0;
int connection=-1,listener=-1;
void terminate(int) {stopping=1;if(connection>=0) shutdown(connection,SHUT_RDWR);if(listener>=0) shutdown(listener,SHUT_RDWR);}
bool read_exact(int fd,std::byte* dst,std::size_t n) {
  while(n) {auto r=recv(fd,dst,n,0);if(r<=0)return false;dst+=r;n-=r;}return true;
}
}
int serve(const std::string& path,Worker& worker,HostRuntime* host) {
  if(path.size()>=sizeof(sockaddr_un::sun_path)) throw std::runtime_error("Unix socket path is too long");
  signal(SIGPIPE,SIG_IGN); signal(SIGTERM,terminate); signal(SIGINT,terminate);
  listener=socket(AF_UNIX,SOCK_STREAM,0);
  sockaddr_un address{}; address.sun_family=AF_UNIX; std::strcpy(address.sun_path,path.c_str());
  if(bind(listener,reinterpret_cast<sockaddr*>(&address),sizeof(address))!=0 || chmod(path.c_str(),0600)!=0 || listen(listener,1)!=0)
    throw std::runtime_error(std::string("Cannot bind worker socket: ")+std::strerror(errno));
  connection=accept(listener,nullptr,nullptr);
  std::mutex writes;
  auto send=[&](ipc::MessageType type,std::uint64_t id,std::string text,std::uint32_t flags=0) {
    auto raw=ipc::encode(type,id,{reinterpret_cast<const std::byte*>(text.data()),text.size()},flags);
    std::lock_guard lock(writes);const std::byte* p=raw.data();auto n=raw.size();
    while(n && connection>=0) {auto r=::send(connection,p,n,0);if(r<=0)break;p+=r;n-=r;}
  };
  worker.set_completion([&](InferenceResult r){send(r.cancelled?ipc::MessageType::status:ipc::MessageType::result,r.id,std::move(r.text),r.cancelled?4:0);});
  if(host) host->send=[&](std::string text){send(ipc::MessageType::result,std::numeric_limits<std::uint64_t>::max(),std::move(text));};
  std::jthread duplex;
  while(connection>=0 && !stopping) {
    std::vector<std::byte> raw(ipc::kHeaderBytes);
    if(!read_exact(connection,raw.data(),raw.size()))break;
    std::uint32_t size;std::memcpy(&size,raw.data()+20,4);
    if(size>ipc::kMaxPayloadBytes)break;
    raw.resize(ipc::kHeaderBytes+size);
    if(size && !read_exact(connection,raw.data()+ipc::kHeaderBytes,size))break;
    auto decoded=ipc::decode(raw);if(!decoded)break;
    auto type=decoded.message.header.type;auto id=decoded.message.header.request_id;
    std::string body(reinterpret_cast<const char*>(decoded.message.payload.data()),size);
    try {
      if(type==ipc::MessageType::shutdown) {send(ipc::MessageType::status,id,"{}");break;}
      if(type==ipc::MessageType::result && host) {host->deliver(id,std::move(body));continue;}
      // Type 13 extends the existing frame protocol with an explicit snapshot.
      if(static_cast<int>(type)==13) {
        auto frame=worker.snapshot(); if(!frame) throw std::runtime_error("No captured frame yet");
        send(ipc::MessageType::result,id,encode_media(*frame).dump());continue;
      }
      if(type==ipc::MessageType::start && !worker.start_monitoring(make_screen_capture(),make_audio_tap())) throw std::runtime_error("Cannot start capture");
      if(type==ipc::MessageType::stop) worker.stop_monitoring();
      if(type==ipc::MessageType::submit) {worker.submit_prompt(id,std::move(body));continue;}
      if(type==ipc::MessageType::cancel) worker.cancel(id);
      if(type==ipc::MessageType::stop_duplex) worker.stop_duplex();
      if(type==ipc::MessageType::start_duplex) {
        if(host) throw std::runtime_error("Full duplex requires the optional native Omni runtime");
        if(duplex.joinable()) duplex.join();
        auto split=body.find('\0');auto session=body.substr(0,split);auto instruction=split==std::string::npos?"":body.substr(split+1);
        duplex=std::jthread([&,id,session,instruction]{
          if(worker.start_duplex(session,instruction)) send(ipc::MessageType::status,id,"{}");
          else send(ipc::MessageType::error,id,R"({"error":"Omni duplex initialization failed"})");
        });continue;
      }
      send(ipc::MessageType::status,id,nlohmann::json{{"ok",true},{"foreground",foreground()}}.dump());
    } catch(const std::exception& e) {send(ipc::MessageType::error,id,nlohmann::json{{"error",e.what()}}.dump());}
  }
  worker.stop_monitoring();
  if(duplex.joinable())duplex.join();
  worker.stop();
  worker.set_completion({});
  if(connection>=0)close(connection);connection=-1;
  if(listener>=0)close(listener);listener=-1;unlink(path.c_str());
  return 0;
}
}

#import <Foundation/Foundation.h>
#import <CoreFoundation/CoreFoundation.h>
#include "jarvis/macos.hpp"
#include <iostream>
int main(int argc,char** argv) {
  @autoreleasepool {
    if(argc<2) {std::cerr<<"usage: deskmate-native-worker SOCKET [OMNI_MODEL_DIRECTORY]\n";return 2;}
    std::unique_ptr<jarvis::IOmniRuntime> runtime;
    jarvis::mac::HostRuntime* host=nullptr;
    if(argc>2) {
#ifdef JARVIS_HAS_REAL_RUNTIME
      runtime=jarvis::make_real_omni_runtime();
#else
      std::cerr<<"Rebuild with JARVIS_RUNTIME_ENABLE_UPSTREAM=ON to use Omni\n";return 2;
#endif
    } else {auto h=std::make_unique<jarvis::mac::HostRuntime>();host=h.get();runtime=std::move(h);}
    jarvis::mac::initialize_foreground_tracking();
    jarvis::Worker worker(std::move(runtime));
    if(!worker.start(argc>2?argv[2]:"deeptutor-byok"))return 1;
    auto loop=CFRunLoopGetMain(); int result=1;
    std::jthread service([&]{
      try {result=jarvis::mac::serve(argv[1],worker,host);}
      catch(const std::exception& e) {std::cerr<<e.what()<<'\n';}
      CFRunLoopPerformBlock(loop,kCFRunLoopCommonModes,^{CFRunLoopStop(loop);});CFRunLoopWakeUp(loop);
    });
    CFRunLoopRun();service.join();return result;
  }
}

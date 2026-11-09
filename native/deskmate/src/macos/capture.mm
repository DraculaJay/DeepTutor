#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/CATapDescription.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreMedia/CoreMedia.h>
#include "jarvis/macos.hpp"
#include <deque>
#include <stdexcept>
#include <cstring>

namespace {
struct VideoQueue {std::mutex mutex; std::condition_variable cv; std::optional<jarvis::VideoFrame> latest; std::string error;};
std::uint64_t now100ns() { return std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::system_clock::now().time_since_epoch()).count()/100; }
void checked(OSStatus code,const char* action) { if(code!=noErr) throw std::runtime_error(std::string(action)+": OSStatus "+std::to_string(code)); }
}
@interface DeskmateScreenOutput : NSObject<SCStreamOutput,SCStreamDelegate>
@property(nonatomic,assign) VideoQueue* frames;
@end
@implementation DeskmateScreenOutput
- (void)stream:(SCStream*)stream didStopWithError:(NSError*)error {
  std::lock_guard lock(self.frames->mutex); self.frames->error=error.localizedDescription.UTF8String; self.frames->cv.notify_all();
}
- (void)stream:(SCStream*)stream didOutputSampleBuffer:(CMSampleBufferRef)sample ofType:(SCStreamOutputType)type {
  if(type!=SCStreamOutputTypeScreen || !CMSampleBufferIsValid(sample)) return;
  auto pixel=CMSampleBufferGetImageBuffer(sample); if(!pixel) return;
  CVPixelBufferLockBaseAddress(pixel,kCVPixelBufferLock_ReadOnly);
  jarvis::VideoFrame f;
  f.width=CVPixelBufferGetWidth(pixel); f.height=CVPixelBufferGetHeight(pixel);
  f.row_pitch=CVPixelBufferGetBytesPerRow(pixel); f.timestamp_100ns=now100ns();
  auto count=std::size_t(f.row_pitch)*f.height; f.bgra.resize(count);
  std::memcpy(f.bgra.data(),CVPixelBufferGetBaseAddress(pixel),count);
  CVPixelBufferUnlockBaseAddress(pixel,kCVPixelBufferLock_ReadOnly);
  { std::lock_guard lock(self.frames->mutex); self.frames->latest=std::move(f); }
  self.frames->cv.notify_one();
}
@end
namespace jarvis::mac {
class ScreenCapture final : public IDesktopCapture {
  VideoQueue frames_;
  SCStream* stream_;
  DeskmateScreenOutput* output_;
  dispatch_queue_t queue_;
 public:
  ~ScreenCapture() override {stop();}
  void start() override {
    @autoreleasepool {
      if(!CGPreflightScreenCaptureAccess() && !CGRequestScreenCaptureAccess())
        throw std::runtime_error("Screen Recording permission denied. Enable the launching app in System Settings > Privacy & Security > Screen & System Audio Recording, then restart it.");
      auto done=dispatch_semaphore_create(0);
      __block SCShareableContent* content=nil; __block NSError* failure=nil;
      [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:YES completionHandler:^(SCShareableContent* value,NSError* error){content=value;failure=error;dispatch_semaphore_signal(done);}];
      dispatch_semaphore_wait(done,DISPATCH_TIME_FOREVER);
      if(failure || content.displays.count==0) throw std::runtime_error(failure?failure.localizedDescription.UTF8String:"No shareable display");
      SCDisplay* display=content.displays.firstObject;
      auto filter=[[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
      auto config=[SCStreamConfiguration new];
      config.width=1280; config.height=std::max(1, int(1280.0*display.height/display.width));
      config.pixelFormat=kCVPixelFormatType_32BGRA; config.minimumFrameInterval=CMTimeMake(1,2);
      config.queueDepth=3; config.showsCursor=YES; config.capturesAudio=NO;
      output_=[DeskmateScreenOutput new]; output_.frames=&frames_;
      queue_=dispatch_queue_create("org.deeptutor.deskmate.screen",DISPATCH_QUEUE_SERIAL);
      stream_=[[SCStream alloc] initWithFilter:filter configuration:config delegate:output_];
      NSError* error=nil;
      if(![stream_ addStreamOutput:output_ type:SCStreamOutputTypeScreen sampleHandlerQueue:queue_ error:&error]) throw std::runtime_error(error.localizedDescription.UTF8String);
      failure=nil;
      [stream_ startCaptureWithCompletionHandler:^(NSError* e){failure=e;dispatch_semaphore_signal(done);}];
      dispatch_semaphore_wait(done,DISPATCH_TIME_FOREVER);
      if(failure) throw std::runtime_error(failure.localizedDescription.UTF8String);
    }
  }
  void stop() noexcept override {
    if(!stream_) return;
    auto done=dispatch_semaphore_create(0);
    [stream_ stopCaptureWithCompletionHandler:^(NSError*){dispatch_semaphore_signal(done);}];
    dispatch_semaphore_wait(done,DISPATCH_TIME_FOREVER);
    [stream_ removeStreamOutput:output_ type:SCStreamOutputTypeScreen error:nil];
    dispatch_sync(queue_, ^{}); stream_=nil; output_=nil;
    std::lock_guard lock(frames_.mutex); frames_.latest.reset(); frames_.error.clear();
  }
  std::optional<VideoFrame> next_frame(std::uint32_t timeout) override {
    std::unique_lock lock(frames_.mutex);
    frames_.cv.wait_for(lock,std::chrono::milliseconds(timeout),[&]{return frames_.latest.has_value() || !frames_.error.empty();});
    if(!frames_.error.empty()) throw std::runtime_error(frames_.error);
    auto f=std::move(frames_.latest); frames_.latest.reset(); return f;
  }
};
class AudioTap final : public IAudioCapture {
  AudioObjectID tap_=kAudioObjectUnknown,device_=kAudioObjectUnknown;
  AudioDeviceIOProcID proc_=nullptr;
  std::mutex mutex_; std::condition_variable cv_; std::deque<audio::PcmBlock> blocks_;
 public:
  ~AudioTap() override {stop();}
  void start() override {
    @autoreleasepool {
      auto desc=[[CATapDescription alloc] initStereoGlobalTapButExcludeProcesses:@[]];
      desc.name=@"DeepTutor course audio"; [desc setPrivate:YES]; desc.muteBehavior=CATapUnmuted;
      checked(AudioHardwareCreateProcessTap(desc,&tap_),"Create process tap (check System Audio Recording permission)");
      AudioStreamBasicDescription format{}; UInt32 size=sizeof(format);
      AudioObjectPropertyAddress property{kAudioTapPropertyFormat,kAudioObjectPropertyScopeGlobal,kAudioObjectPropertyElementMain};
      checked(AudioObjectGetPropertyData(tap_,&property,0,nullptr,&size,&format),"Read tap format");
      if(!(format.mFormatFlags&kAudioFormatFlagIsFloat) || format.mBitsPerChannel!=32) throw std::runtime_error("Expected Float32 process tap PCM");
      NSDictionary* config=@{@kAudioAggregateDeviceNameKey:@"DeepTutor private course tap",
        @kAudioAggregateDeviceUIDKey:NSUUID.UUID.UUIDString,
        @kAudioAggregateDeviceIsPrivateKey:@YES,
        @kAudioAggregateDeviceTapAutoStartKey:@YES,
        @kAudioAggregateDeviceTapListKey:@[@{@kAudioSubTapUIDKey:desc.UUID.UUIDString,@kAudioSubTapDriftCompensationKey:@YES}]};
      checked(AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)config,&device_),"Create tap aggregate device");
      auto queue=dispatch_queue_create("org.deeptutor.deskmate.system-audio",DISPATCH_QUEUE_SERIAL);
      AudioTap* owner=this;
      checked(AudioDeviceCreateIOProcIDWithBlock(&proc_,device_,queue,^(const AudioTimeStamp*,const AudioBufferList* input,const AudioTimeStamp*,AudioBufferList*,const AudioTimeStamp*) {
        if(input->mNumberBuffers==0 || !input->mBuffers[0].mData) return;
        audio::PcmBlock b; b.format.sample_rate=format.mSampleRate; b.format.channels=format.mChannelsPerFrame; b.timestamp_100ns=now100ns();
        auto frames=input->mBuffers[0].mDataByteSize/(sizeof(float)*input->mBuffers[0].mNumberChannels);
        b.interleaved.resize(frames*b.format.channels);
        if(input->mNumberBuffers==1) std::memcpy(b.interleaved.data(),input->mBuffers[0].mData,b.interleaved.size()*sizeof(float));
        else for(std::size_t f=0;f<frames;++f) for(unsigned c=0;c<b.format.channels;++c)
          b.interleaved[f*b.format.channels+c]=reinterpret_cast<float*>(input->mBuffers[c].mData)[f];
        {std::lock_guard lock(owner->mutex_); if(owner->blocks_.size()>=64) owner->blocks_.pop_front(); owner->blocks_.push_back(std::move(b));}
        owner->cv_.notify_one();
      }),"Install tap IO callback");
      checked(AudioDeviceStart(device_,proc_),"Start system audio tap");
    }
  }
  void stop() noexcept override {
    if(proc_) {AudioDeviceStop(device_,proc_);AudioDeviceDestroyIOProcID(device_,proc_);proc_=nullptr;}
    if(device_!=kAudioObjectUnknown) {AudioHardwareDestroyAggregateDevice(device_);device_=kAudioObjectUnknown;}
    if(tap_!=kAudioObjectUnknown) {AudioHardwareDestroyProcessTap(tap_);tap_=kAudioObjectUnknown;}
    std::lock_guard lock(mutex_); blocks_.clear();
  }
  std::optional<audio::PcmBlock> next_block(std::uint32_t timeout) override {
    std::unique_lock lock(mutex_); cv_.wait_for(lock,std::chrono::milliseconds(timeout),[&]{return !blocks_.empty();});
    if(blocks_.empty()) return {}; auto b=std::move(blocks_.front());blocks_.pop_front();return b;
  }
};
std::unique_ptr<IDesktopCapture> make_screen_capture(){return std::make_unique<ScreenCapture>();}
std::unique_ptr<IAudioCapture> make_audio_tap(){return std::make_unique<AudioTap>();}
std::uintptr_t foreground_id() noexcept {@autoreleasepool {return NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;}}
bool is_game_launcher(std::uintptr_t pid) noexcept {@autoreleasepool {auto app=[NSRunningApplication runningApplicationWithProcessIdentifier:pid];return [app.bundleIdentifier isEqualToString:@"com.valvesoftware.steam"];}}
nlohmann::json foreground() {@autoreleasepool {
  auto app=NSWorkspace.sharedWorkspace.frontmostApplication;
  return {{"pid",app.processIdentifier},{"name",app.localizedName.UTF8String ?: ""},{"bundle_id",app.bundleIdentifier.UTF8String ?: ""}};
}}
}

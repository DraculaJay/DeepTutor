cmake_minimum_required(VERSION 3.24)

# Stable, dependency-free boundary. This target performs model layout
# validation only and must not be represented as an inference implementation.
add_library(jarvis_runtime_boundary STATIC src/model_layout.cpp)
add_library(jarvis::runtime_boundary ALIAS jarvis_runtime_boundary)
target_include_directories(jarvis_runtime_boundary PUBLIC
  "$<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>"
  "$<INSTALL_INTERFACE:include>")
target_compile_features(jarvis_runtime_boundary PUBLIC cxx_std_20)

option(JARVIS_RUNTIME_ENABLE_UPSTREAM
  "Build the pinned llama.cpp-omni LLM+VPM+APM provider from a separately acquired source tree"
  OFF)
set(JARVIS_RUNTIME_UPSTREAM_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/vendor" CACHE PATH
  "Pinned llama.cpp-omni source directory used when JARVIS_RUNTIME_ENABLE_UPSTREAM=ON")

if(JARVIS_RUNTIME_ENABLE_UPSTREAM)
  if(NOT IS_ABSOLUTE "${JARVIS_RUNTIME_UPSTREAM_SOURCE_DIR}")
    get_filename_component(JARVIS_RUNTIME_UPSTREAM_SOURCE_DIR
      "${JARVIS_RUNTIME_UPSTREAM_SOURCE_DIR}" ABSOLUTE BASE_DIR "${CMAKE_SOURCE_DIR}")
  endif()
  foreach(required_file IN ITEMS CMakeLists.txt LICENSE tools/omni/CMakeLists.txt src/models/models.h)
    if(NOT EXISTS "${JARVIS_RUNTIME_UPSTREAM_SOURCE_DIR}/${required_file}")
      message(FATAL_ERROR "Pinned runtime source is missing ${required_file}. Obtain the complete checksum-pinned source with cmake/AcquireUpstream.cmake and set JARVIS_RUNTIME_UPSTREAM_SOURCE_DIR; see docs/MACOS_SETUP.md")
    endif()
  endforeach()

  # The upstream omni target currently compiles TTS/projector/token2wav into the
  # same library as LLM/VPM/APM. Linking it would violate this boundary's scope.
  # Keep this a hard gate until patches/0001-text-input-runtime.patch exists,
  # is checksum-pinned in VENDOR.json, and exposes a text-only upstream target.
  if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/patches/0001-text-input-runtime.patch")
    message(FATAL_ERROR
      "Upstream inference is intentionally gated: the pinned source has no separable text-only LLM+VPM+APM target. See INTEGRATION.md")
  endif()

  # The reference checkout is read-only. Apply Jarvis's existing pinned patch
  # to a build-local copy; never alter the sibling repository.
  set(prepared "${CMAKE_CURRENT_BINARY_DIR}/patched-upstream")
  file(COPY "${JARVIS_RUNTIME_UPSTREAM_SOURCE_DIR}/" DESTINATION "${prepared}" PATTERN ".git" EXCLUDE)
  file(READ "${prepared}/tools/omni/CMakeLists.txt" omni_cmake)
  if(NOT omni_cmake MATCHES "omni_text_runtime")
    execute_process(COMMAND patch -p1 -i "${CMAKE_CURRENT_SOURCE_DIR}/patches/0001-text-input-runtime.patch"
      WORKING_DIRECTORY "${prepared}" RESULT_VARIABLE patch_status)
    if(NOT patch_status EQUAL 0)
      message(FATAL_ERROR "Unable to apply the pinned Jarvis runtime patch")
    endif()
  endif()
  set(LLAMA_BUILD_COMMON ON CACHE BOOL "" FORCE)
  set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
  set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
  set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
  set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
  set(LLAMA_BUILD_APP OFF CACHE BOOL "" FORCE)
  set(LLAMA_BUILD_UI OFF CACHE BOOL "" FORCE)
  set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
  set(LLAMA_OPENSSL OFF CACHE BOOL "Local Omni inference does not need HTTPS" FORCE)
  set(ENABLE_COREML OFF CACHE BOOL "Use Metal without optional CoreML model artifacts" FORCE)
  add_subdirectory("${prepared}"
                   "${CMAKE_CURRENT_BINARY_DIR}/upstream" EXCLUDE_FROM_ALL)
  add_subdirectory("${prepared}/tools/omni" "${CMAKE_CURRENT_BINARY_DIR}/omni" EXCLUDE_FROM_ALL)
  if(NOT TARGET omni_text_runtime)
    message(FATAL_ERROR "Pinned patch contract requires target omni_text_runtime")
  endif()
  add_library(jarvis_runtime_provider INTERFACE)
  add_library(jarvis::runtime_provider ALIAS jarvis_runtime_provider)
  target_link_libraries(jarvis_runtime_provider INTERFACE
    jarvis_runtime_boundary omni_text_runtime)
endif()

if(NOT TARGET ReactAndroid::hermestooling)
add_library(ReactAndroid::hermestooling SHARED IMPORTED)
set_target_properties(ReactAndroid::hermestooling PROPERTIES
    IMPORTED_LOCATION "/Users/stanislav.doskalenko/.gradle/caches/9.4.1/transforms/163d79755b79682e9ee0e379967cd147/transformed/react-android-0.88.0-release/prefab/modules/hermestooling/libs/android.arm64-v8a/libhermestooling.so"
    INTERFACE_INCLUDE_DIRECTORIES "/Users/stanislav.doskalenko/.gradle/caches/9.4.1/transforms/163d79755b79682e9ee0e379967cd147/transformed/react-android-0.88.0-release/prefab/modules/hermestooling/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

if(NOT TARGET ReactAndroid::jsi)
add_library(ReactAndroid::jsi SHARED IMPORTED)
set_target_properties(ReactAndroid::jsi PROPERTIES
    IMPORTED_LOCATION "/Users/stanislav.doskalenko/.gradle/caches/9.4.1/transforms/163d79755b79682e9ee0e379967cd147/transformed/react-android-0.88.0-release/prefab/modules/jsi/libs/android.arm64-v8a/libjsi.so"
    INTERFACE_INCLUDE_DIRECTORIES "/Users/stanislav.doskalenko/.gradle/caches/9.4.1/transforms/163d79755b79682e9ee0e379967cd147/transformed/react-android-0.88.0-release/prefab/modules/jsi/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

if(NOT TARGET ReactAndroid::reactnative)
add_library(ReactAndroid::reactnative SHARED IMPORTED)
set_target_properties(ReactAndroid::reactnative PROPERTIES
    IMPORTED_LOCATION "/Users/stanislav.doskalenko/.gradle/caches/9.4.1/transforms/163d79755b79682e9ee0e379967cd147/transformed/react-android-0.88.0-release/prefab/modules/reactnative/libs/android.arm64-v8a/libreactnative.so"
    INTERFACE_INCLUDE_DIRECTORIES "/Users/stanislav.doskalenko/.gradle/caches/9.4.1/transforms/163d79755b79682e9ee0e379967cd147/transformed/react-android-0.88.0-release/prefab/modules/reactnative/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()


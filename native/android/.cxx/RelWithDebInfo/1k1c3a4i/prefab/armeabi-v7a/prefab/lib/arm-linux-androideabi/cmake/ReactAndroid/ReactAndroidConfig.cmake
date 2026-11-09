if(NOT TARGET ReactAndroid::hermestooling)
add_library(ReactAndroid::hermestooling SHARED IMPORTED)
set_target_properties(ReactAndroid::hermestooling PROPERTIES
    IMPORTED_LOCATION "/Users/stanislav.doskalenko/.gradle/caches/9.3.1/transforms/e88424997ecf7ed9545c92fde2f71276/transformed/react-android-0.86.2-release/prefab/modules/hermestooling/libs/android.armeabi-v7a/libhermestooling.so"
    INTERFACE_INCLUDE_DIRECTORIES "/Users/stanislav.doskalenko/.gradle/caches/9.3.1/transforms/e88424997ecf7ed9545c92fde2f71276/transformed/react-android-0.86.2-release/prefab/modules/hermestooling/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

if(NOT TARGET ReactAndroid::jsi)
add_library(ReactAndroid::jsi SHARED IMPORTED)
set_target_properties(ReactAndroid::jsi PROPERTIES
    IMPORTED_LOCATION "/Users/stanislav.doskalenko/.gradle/caches/9.3.1/transforms/e88424997ecf7ed9545c92fde2f71276/transformed/react-android-0.86.2-release/prefab/modules/jsi/libs/android.armeabi-v7a/libjsi.so"
    INTERFACE_INCLUDE_DIRECTORIES "/Users/stanislav.doskalenko/.gradle/caches/9.3.1/transforms/e88424997ecf7ed9545c92fde2f71276/transformed/react-android-0.86.2-release/prefab/modules/jsi/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

if(NOT TARGET ReactAndroid::reactnative)
add_library(ReactAndroid::reactnative SHARED IMPORTED)
set_target_properties(ReactAndroid::reactnative PROPERTIES
    IMPORTED_LOCATION "/Users/stanislav.doskalenko/.gradle/caches/9.3.1/transforms/e88424997ecf7ed9545c92fde2f71276/transformed/react-android-0.86.2-release/prefab/modules/reactnative/libs/android.armeabi-v7a/libreactnative.so"
    INTERFACE_INCLUDE_DIRECTORIES "/Users/stanislav.doskalenko/.gradle/caches/9.3.1/transforms/e88424997ecf7ed9545c92fde2f71276/transformed/react-android-0.86.2-release/prefab/modules/reactnative/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()


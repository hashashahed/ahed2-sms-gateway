plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.smsgw.gateway"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.smsgw.gateway"
        minSdk = 26
        targetSdk = 35
        versionCode = 3
        versionName = "2.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key so the release APK installs without extra setup.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.preference:preference-ktx:1.2.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // Google's QR scanner UI from Play Services: no camera permission, tiny APK size impact.
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
}

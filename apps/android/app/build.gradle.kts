plugins {
    id("com.android.application")
}

val tvUrl = providers.gradleProperty("tvUrl").get()
// ключ підпису лише з env (див. .env.example); без нього release не підписується, для тесту є debug
val keystore = System.getenv("ANDROID_KEYSTORE")

android {
    namespace = "men.sunhunter.tv"
    compileSdk = 36

    defaultConfig {
        applicationId = "men.sunhunter.tv"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "TV_URL", "\"$tvUrl\"")
    }
    buildFeatures { buildConfig = true }

    signingConfigs {
        if (keystore != null) create("release") {
            storeFile = file(keystore)
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("ANDROID_KEY_ALIAS")
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }
    lint {
        // 36: нові API 37 телевізорам не потрібні; бекап вимкнено цілком, правила для нього зайві
        disable += setOf("OldTargetApi", "GradleDependency", "DataExtractionRules")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.media3:media3-exoplayer:1.11.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.11.1")
}

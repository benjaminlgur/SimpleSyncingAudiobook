const { withAppBuildGradle } = require("expo/config-plugins");

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (result) => {
    if (result.modResults.language !== "groovy")
      throw new Error("Expected Groovy Android build file");
    let source = result.modResults.contents;
    if (source.includes("// audiobook release signing")) return result;
    if (!source.includes("signingConfig signingConfigs.debug"))
      throw new Error("Expo release signing template changed");
    source = source.replace(
      "signingConfigs {",
      `signingConfigs {
        // audiobook release signing
        release {
            def signingFile = System.getenv("ANDROID_KEYSTORE_PATH")
            if (signingFile) storeFile file(signingFile)
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }`,
    );
    // Only the release block: development builds can continue using the debug key.
    // Locate through buildTypes rather than depending on Expo's comment wording.
    const buildTypes = source.indexOf("buildTypes {");
    const releaseStart = source.indexOf("release {", buildTypes);
    const signing = source.indexOf(
      "signingConfig signingConfigs.debug",
      releaseStart,
    );
    if (buildTypes < 0 || releaseStart < 0 || signing < 0)
      throw new Error("Cannot locate Android release signing");
    source =
      source.slice(0, signing) +
      source
        .slice(signing)
        .replace(
          "signingConfig signingConfigs.debug",
          "signingConfig signingConfigs.release",
        );
    source += `
gradle.taskGraph.whenReady { graph ->
    if (graph.allTasks.any { it.name.toLowerCase().contains("release") }) {
        ["ANDROID_KEYSTORE_PATH", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"].each { name ->
            if (!System.getenv(name)) throw new GradleException("Missing release signing environment variable: " + name)
        }
    }
}
`;
    result.modResults.contents = source;
    return result;
  });
};

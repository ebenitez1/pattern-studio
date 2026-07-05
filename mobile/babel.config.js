module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo (SDK 57) automatically appends the reanimated v4
    // worklets plugin ("react-native-worklets/plugin") when the
    // react-native-worklets package is installed — adding it manually here
    // would apply it twice. See babel-preset-expo/build/configs/expo.js.
    presets: ["babel-preset-expo"],
  };
};

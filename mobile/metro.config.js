const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Single worker — slower but prevents parallel OOM crashes on Windows.
config.maxWorkers = 1;

// Exclude Expo's ephemeral temp folders from the file watcher.
// On Windows + OneDrive these directories are created and immediately deleted,
// which causes Metro's FallbackWatcher to crash with ENOENT.
const escape = (s) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
config.resolver = {
  ...config.resolver,
  blockList: [
    new RegExp(escape(path.join(__dirname, 'node_modules', '.expo-')) + '.*'),
  ],
};

module.exports = config;

const common = require("../common");
module.exports = {
  mode: "development",
  entry: "./src/main.js",
  module: {
    rules: [
      {
        test: /\.rei?$/,
        use: [
          {
            loader: common.pluginPath,
            options: { separateEsyJson: true },
          },
        ],
      },
    ],
  },
};

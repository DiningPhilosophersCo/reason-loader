# reason-loader

A webpack loader for Reason and OCaml files.

## Installation

This package is available on NPM.

```sh
npm i reason-loader
```


 # Usage

 ```js
{
   module: {
     rules: [
       {
         test: /\.rei?$/,
         use: [
           {
             loader: 'reason-loader',
             options: {}
           }
         ]
       }
     ]
   }
 }
```
# Example

See how it is used in [reason-ocaml.in docusaurus setup](https://github.com/ReasonOCamlIndia/reason-ocaml-india.github.io/blob/master/plugins/docusaurus-webpack-plugin/index.js)

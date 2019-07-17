# geogrid.js

The library `geogrid.js` provides a [Leaflet](http://leafletjs.com) layer that depicts data aggregated by the ISEA3H Discrete Global Grid System.  Thereby, the library renders the visualization using [WebGL](https://en.wikipedia.org/wiki/WebGL).

![Overview](https://github.com/mocnik-science/geogrid.js/blob/master/docs/images/screenshot.jpg)

## Scientific Publications

The following publication is related to this plugin and the used Discrete Global Grid System (DGGS):

* F-B Mocnik: [**A Novel Identifier Scheme for the ISEA Aperture 3 Hexagon Discrete Global Grid System.**](http://doi.org/10.1080/15230406.2018.1455157) Cartography and Geographic Information Science 46(3), 2019, 227–291

## Related Software

This library is compatible with the framework [**Measures REST**](https://github.com/giscience/measures-rest), which can be used to aggregate data by a grid and then provide the data via a REST interface.  Data can also be aggregated manually by using the library [**geogrid**](https://github.com/mocnik-science/geogrid) that computes and handles Discrete Global Grid Systems (DGGS).

## Use the Library

The library `geogrid.js` requires different other libraries to be loaded:

* [Leaflet](http://leafletjs.com)
* [PixiJS](http://www.pixijs.com)
* [Leaflet.PixiOverlay](https://github.com/manubb/Leaflet.PixiOverlay)
* [D3.js](https://d3js.org)

In addition, the [vptree.js library](http://fpirsch.github.io/vptree.js/) needs to be placed in the directory `/libs`.  In particular, the library should be made accessible as `/libs/vptree.js/vptree.min.js`.

In order to use the `ISEA3HLayer`, a Leaflet map needs to be loaded first, for example, like follows:

```javascript
var map = L.map('map').setView([49.4, 8.7], 10);
```

In the following, we can add the `ISEA3HLayer`, which is provided by this library:

```javascript
var isea3h = L.isea3hLayer({
  url: 'http://localhost:8080/api/test-measure/grid?resolution={resolution}&bbox={bbox}&date={date}&dateFrom={dateFrom}',
}).addTo(map);
```

As an option, a URL needs to be provided under which data aggregated by the ISEA3H grid is available.  The URL potentially contains information about the bounding box and the resolution, encoded by `{bbox}` and `{resolution}` respectively.  Further parameters can be encoded, as is discussed in the description of the option `parameters`.  The data should be formatted as follows:

```json
{
    "type":"grid",
    "resolution":14,
    ...
    "data":[
        {"value":0.345, "id":"1309502766029885663"},
        {"value":null, "id":"1309502851015240491"},
        ...
    ]
}
```

The grid cell IDs are assumed to conform to both *adaptive* and *non-adaptive IDs*, as is described in:

* F.-B. Mocnik: **A Novel Identifier Scheme for the ISEA Aperture 3 Hexagon Discrete Global Grid System.** Cartography and Geographic Information science, 2018, to appear

Data which is formatted in the above format is, for example, provided by the framework [Measures REST](https://github.com/giscience/measures-rest).

The `ISEA3HLayer` can be used in combination with different base maps.  A good choice is [Toner lite by Stamen](http://maps.stamen.com/toner-lite).  The complete code of the example is as follows:

```javascript
var map = L.map('map').setView([49.4, 8.7], 10);
L.stamenTileLayer('toner-lite').addTo(map);
L.isea3hLayer({
  url: 'http://localhost:8080/api/test-measure/grid?resolution={resolution}&bbox={bbox}&date={date}&dateFrom={dateFrom}',
}).addTo(map);
```

## Example

An example can be found in the subdirectory [example](https://github.com/mocnik-science/geogrid.js/tree/master/example).  To run the example, please generate first the file `geogrid.min.js` as described below, and then run:

```bash
npm run build-example
```

Observe that the example presumes a local instance of [Measures REST](https://github.com/giscience/measures-rest).

## Options

The `ISEA3HLayer` accepts several options, which allow to easily adapt the layer to the data source and the visualization needs.  Instead of depicting representing the value related to a grid cell by the colour, the value can also be encoded by the size of the grid cell:

```javascript
L.isea3hLayer({
  url: '...',
  cellColorKey: null,
  cellSizeKey: 'value',
})
```

Even two different values related to a grid cell can be represented, for example, the value with key `value1` encoded by the colour, and the value with key `value2`, by the size of the cell:

```javascript
L.isea3hLayer({
  url: '...',
  cellColorKey: 'value1',
  cellSizeKey: 'value2',
})
```

The following options are available:

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `url` | `String` | `null` | URL under which data aggregated by the ISEA3H grid is available.  The URL potentially contains information about the bounding box and the resolution, encoded by `{bbox}` and `{resolution}` respectively.  Further parameters can be used in the `url` by providing corresponding values in the option `parameters`.  The expected format of the returned data is described above. |
| `data` | `Array` | `null` | Instead of the parameter `url`, the data can be provided explicitly. |
| `silent` | `Boolean` | `true` | Enables silent mode.  When enabled, debug information is suppressed in the console. |
| `debug` | `Boolean` | `false` | Enables debug mode.  When enabled, the grid cells are highlighted, and debug information is shown in the console (`silent` is `false`). |
| `resolution` | `Function` | `...` | A function which results, for a given zoom level of the map as input parameter, a resolution of the grid |
| `parameters` | `Array` | `{date: new Date().toLocaleDateString(), dateFrom: null}` | Additional parameters that can be used in the `url`. |
| `cellColorKey` | `String` | `value` | The colour to be used for a grid cell can be chosen in dependence of the property `cellColorKey` of the cell.  The colour is, accordingly, determined by computing the function `cellColorScale` with the property `cellColorKey` of the cell as argument.  If the option `cellColorKey` is `null`, the colour `cellColorNoKey` is used instead. |
| `cellColorMin` | `Number` | `0` | Minimum value to be used in `cellColorScale`.  If `null`, the minimum value is determined by the data of the currently cached cells. |
| `cellColorMax` | `Number` | `null` | Maximum value to be used in `cellColorScale`.  If `null`, the maximum value is determined by the data of the currently cached cells. |
| `cellColorScale` | `Function` | `(min, max) => d3.scaleLinear().domain([min, max]).range(['#fff', '#f00'])` | This option is used to determine the colour to be used for a grid cell, when `cellColorKey` is not `null`.  This option is either (1) a function that returns, for a the property `cellColorKey` of the cell, the colour that should be used for the cell; or (2) a function that returns for given `min` and `max` values a function as in (1). |
| `cellColorNoData` | `String` | `'#eee'` | Colour to be used for a grid cell, when no data is available for this particular cell. |
| `cellColorNoKey` | `String` | `'#f00'` | Colour to be used for a grid cell, when `cellColorKey` is `null`. |
| `cellColorOpacity` | `Number` | `.5` | Opacity of the colour to be used for the grid cells. |
| `cellSizeKey` | `String` | `null` | The relative size of a grid cell can be chosen in dependence of the property `cellSizeKey` of the cell.  The relative size is, accordingly, determined by computing the function `cellSizeScale` with the property `cellSizeKey` of the cell as argument.  If the option `cellSizeKey` is `null`, the relative size `cellSizeNoKey` is used instead. |
| `cellSizeMin` | `Number` | `0` | Minimum value to be used in `cellSizeScale`.  If `null`, the minimum value is determined by the data of the currently cached cells. |
| `cellSizeMax` | `Number` | `null` | Maximum value to be used in `cellSizeScale`.  If `null`, the maximum value is determined by the data of the currently cached cells. |
| `cellSizeScale` | `Function` | `(min, max) => {return value => (value - min) / (max - min)}` | This option is used to determine the relative size to be used for a grid cell, when `cellSizeKey` is not `null`.  This option is either (1) a function that returns, for a the property `cellSizeKey` of the cell, the relative size that should be used for the grid cell; or (2) a function that returns for given `min` and `max` values a function as in (1). |
| `cellSizeNoData` | `Number` | `0` | Relative size to be used for a grid cell, when no data is available for this particular cell. |
| `cellSizeNoKey` | `Number` | `1` | Relative size to be used for a grid cell, when `cellSizeKey` is `null`. |
| `cellContourColor` | `String` | `'#fff'` | Colour to be used for the contour of a cell. |
| `cellContourWidth` | `Number` | `2` | Width of the contour of a cell. |
| `colorProgressBar` | `String` | `'#ff5151'` | Colour of the progress bar shown when loading new data. |
| `colorDebug` | `String` | `'#1e90ff'` | Colour used to highlight certain aspects when using the `debug` mode. |
| `colorDebugEmphasized` | `String` | `'#f00'` | Colour used to highlight very important aspects when using the `debug` mode. |
| `attribution` | `String` | `'&copy; <a href="http://www.uni-heidelberg.de">Heidelberg University</a>'` | Attribution to be shown. |
| `bboxViewPad` | `Number` | `1.05` | Size of the bounding box for which data is rendered in the layer, when the view of the map has changed (moving the view, changing the zoom level, etc.) |
| `bboxDataPad` | `Number` | `1.25` | Size of the bounding box for which data is requested using the `url`, when the view of the map has changed (moving the view, changing the zoom level, etc.) |
| `renderer` | `'webgl'`\|`'svg'` | `'webgl'` | Renderer to be used.  The WebGL renderer (default choice) is much faster than the SVG renderer, but the SVG renderer might offer advantages in some scenarios where a interaction is crucial. |
| `urlLibs` | String | `'/libs'` | URL under which the libraries can be found. In particular, the file `vptree.js/vptree.min.js` should exist in the directory `urlLibs`. |

## Plugins

The functionality of the `ISEA3HLayer` can be extended by plugins.  Such plugins can easily be added to the layer:

```javascript
var isea3h = L.isea3hLayer({...});
isea3h.addPlugin(L.testPlugin());
```

The following plugins are available:

* more plugins are to be implemented

## Authoring Plugins

### General Structure of a Plugin

Plugins extend the class `ISEA3HLayerPlugin`.  Several methods exist that can be overwritten in order to react to certain events.  A plugin can, for example, be implemented as follows:

```javascript
class TestPlugin extends ISEA3HLayerPlugin {
  onHover(e) {
    console.debug('hover', e.cell.id, e.cell.value)
  }
  onUnhover(e) {
    console.debug('unhover', e.cell.id, e.cell.value)
  }
  onClick(e) {
    console.debug('click', e.cell.id, e.cell.value)
  }
  ...
}
```

In addition to a class, a factory method should be provided in order to simplify the instantiation of the plugin:

```javascript
L.testPlugin = () => new TestPlugin()
```

### Events

Plugins to the `ISEA3HLayer` follow the [paradigm of reactive programming](https://en.wikipedia.org/wiki/Reactive_programming): changes in the system that consists of the map and the user fire events of the plugin.  The corresponding method to an event is only executed, in case it is implemented.  The method `onHover` is, for example, executed when the `hover` event is fired.  If a corresponding method is not present, no error is thrown.  The following event listeners can be used:

| Event listener | Description |
| -------------- | ----------- |
| `onHover` | the cursor hovers a cell |
| `onUnhover` | the cursor moves out of a cell |
| `onClick` | the user clicks on a cell |

### Methods

Plugins can react to events by performing an action as soon as an event is triggered.  Such an action can change the state of the `ISEA3HLayer`, or other parts of the website.  As an example, a cell can be drawn in `blue` colour when it is hovered by the courser:

```javascript
onHover(e) {
  this.setCellColor(e.cell, 'blue')
  this.render()
}
```

The URL that is used to retrieve data from a server contains parameters.  Among these parameters are the resolution and the bounding box, but potentially also additional parameters.  These additional parameters can, for example, be set as follows:

```javascript
this.setParameter('date', '2017-01-01')
this.downloadData()
```

Some of the functions except a callback as parameter because the result is computed asynchronously:

```javascript
onHover(e) {
  this.neighbors(e.cell, cell => {
    console.debug(cell)
  })
}
```

The following methods of the `ISEA3HLayerPlugin` are available:

| Method | Description |
| ------ | ----------- |
| `downloadData()` | Forces the data to be downloaded anew.  After having downloaded the data, the method `render` is automatically executed. |
| `render()` | Forces the layer to render. |
| `neighbors(cell, callback)` | Computes the direct neighbours of the grid cell `cell`.  The function `callback` is called with the list of neighbouring cells as an argument. |
| `getParameter(parameter)` | Gets the value of a parameter.  Such parameters can be used in the URL when requesting data from the server. |
| `setParameter(parameter, value)` | Sets a parameter. Such parameters can be used in the URL when requesting data from the server.  The method `downloadData` needs to be called to make the change effective. |
| `setCellColor(cell, color)` | Sets the colour of the grid cell `cell` to `color`.  If `color` is `null`, the colour of the grid cell is computed by using the options `cellColor*`.  The method `render` needs to be called to make the change effective. |
| `resetCellColor()` | Computes the colour of all grid cells by using the options `cellColor*`.  The method `render` needs to be called to make the change effective. |
| `setCellSize(cell, size)` | Sets the relative size of the grid cell `cell` to `size`.  If `size` is `null`, the relative size of the grid cell is computed by using the options `cellSize*`.  The method `render` needs to be called to make the change effective. |
| `resetCellSize()` | Computes the relative size of all grid cells by using the options `cellSize*`.  The method `render` needs to be called to make the change effective. |

## Build geogrid.min.js

The library can be translated from [ECMAScript 6](https://en.wikipedia.org/wiki/ECMAScript) to minified JavaScript, which results in a file `geogrid.min.js`.  In order to generate this minified file, you have to install [Node.js](https://nodejs.org/) first.  Thereafter, you have to execute the following commands:

```bash
npm install
npm run build
```

The resulting minified file can be found in the subdirectory `dist`, which is created during this process.  In addition, a [JavaScript Source Map](https://developer.mozilla.org/en-US/docs/Tools/Debugger/How_to/Use_a_source_map) is created.

## Author

This software is written and maintained by Franz-Benjamin Mocnik, <mail@mocnik-science.net>.

In 2017–2019, this software has been supported by the DFG project *A framework for measuring the fitness for purpose of OpenStreetMap data based on intrinsic quality indicators* (FA 1189/3-1).

All commits after 9/2019 (c) by Franz-Benjamin Mocnik, 2019.
All commits before 8/2019 (c) by Heidelberg University, 2017–2019.

## License

The code is licensed under the [MIT license](https://github.com/mocnik-science/geogrid.js/blob/master/LICENSE).

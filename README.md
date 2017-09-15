# geogrid.js

The library `geogrid.js` provides a [Leaflet](http://leafletjs.com) layer that depicts data aggregated by the ISEA3H Discrete Global Grid System.  Thereby, the library renders the visualization using [WebGL](https://en.wikipedia.org/wiki/WebGL).

![Overview](https://github.com/giscience/geogrid.js/blob/master/docs/images/screenshot.jpg)

## Related Software

This library is compatible with the framework [**Measures REST**](https://github.com/giscience/measures-rest), which can be used to aggregate data by a grid and then provide the data by a REST interface.  Data can also be aggregated manually by using the library [**geogrid**](https://github.com/giscience/geogrid) that computes and handles Discrete Global Grid Systems (DGGS).

## Use the Library

The library `geogrid.js` requires different other libraries to be loaded:

* [Leaflet](http://leafletjs.com)
* [PixiJS](http://www.pixijs.com)
* [Leaflet.PixiOverlay](https://github.com/manubb/Leaflet.PixiOverlay)
* [D3.js](https://d3js.org)

In order to use the `ISEA3HLayer`, a Leaflet map needs to be loaded first, for example, like follows:

```javascript
var map = L.map('map').setView([49.4, 8.7], 10);
```

In the following, we can add the `ISEA3HLayer`, which is provided by this library:

```javascript
var isea3h = L.isea3hLayer({
  url: 'http://localhost:8080/api/test-measure/grid?bbox={bbox}&resolution={resolution}',
}).addTo(map);
```

As an option, a URL needs to be provided under which data aggregated by the ISEA3H grid is available.  The URL potentially contains information about the bounding box and the resolution, encoded by `{bbox}` and `{resolution}` respectively. The data should be formatted as follows:

```json
{
    "type":"grid",
    "resolution":14,
    "data":[
        {"value":.345, "id":"1309502766029885663"},
        {"value":null, "id":"1309502851015240491"},
        ...
    ]
}
```

Such data can, for example, be provided by the framework [Measures REST](https://github.com/giscience/measures-rest).

The `ISEA3HLayer` can be used in combination with different base maps.  A good choice is [Toner lite by Stamen](http://maps.stamen.com/toner-lite).  The complete code of the example is as follows:

```javascript
var map = L.map('map').setView([49.4, 8.7], 10);
new L.StamenTileLayer('toner-lite', {opacityGridFill: .5}).addTo(map);
var isea3h = L.isea3hLayer({
  url: 'http://localhost:8080/api/test-measure/grid?bbox={bbox}&resolution={resolution}',
}).addTo(map);
```

## Example

An example can be found in the subdirectory [example](https://github.com/giscience/measures-rest/tree/master/example).  To run the example, please generate first the file `geogrid.min.js` as described below, and then run:

```bash
npm run build-example
```

Observe that the example presumes a local instance of [Measures REST](https://github.com/giscience/measures-rest).

## Options

The `ISEA3HLayer` accepts several options, which are explained in the following:

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `url` | `String` | `null` | URL under which data aggregated by the ISEA3H grid is available.  The URL potentially contains information about the bounding box and the resolution, encoded by `{bbox}` and `{resolution}` respectively.  The format of the data is described above. |
| `data` | `Array` | `null` | Instead of the parameter `url`, the data can be provided explicitly. |
| `silent` | `Boolean` | `true` | Enables silent mode.  When enabled, debug information is suppressed in the console. |
| `debug` | `Boolean` | `false` | Enables debug mode.  When enabled, the grid cells are highlighted, and debug information is shown in the console (`silent` is `false`). |
| `opacityGridFill` | `Number` | `.5` | Opacity of the fill colour of the grid cells. |
| `resolution` | `Function` | `...` | A function which results, for a given zoom level of the map as input parameter, a resolution of the grid |
| `bboxViewPad` | `Number` | `1.1` | Size of the bounding box for which data is rendered in the layer, when the view of the map has changed (moving the view, changing the zoom level, etc.) |
| `bboxDataPad` | `Number` | `1.1` | Size of the bounding box for which data is requested using the `url`, when the view of the map has changed (moving the view, changing the zoom level, etc.) |
| `colorGridFillData` | `Function` | `d3.scaleLinear().domain([0, 3000000]).range(['#fff', '#f00'])` | Function that returns, for a given value for a grid cell, the colour which should be used to fill the cell. |
| `colorGridFillNoData` | `String` | `'#eee'` | Colour to be used to fill a grid cell, when no data is available for this particular cell. |
| `colorGridContour` | `String` | `'#fff'` | Colour to be used for the contour of a cell. |
| `widthGridContour` | `Number` | `2` | Width of the contour of a cell. |
| `sizeGridData` | `() => 1` | Function that returns, for a given value for a grid cell, the relative size of a grid cell. The default value (`1`) means that the cell has exactly its original size. |
| `sizeGridNoData` | `1` | Relative size of a grid cell, when no data is available for this particular cell. The default value (`1`) means that the cell has exactly its original size. |
| `colorProgressBar` | `String` | `'#ff5151'` | Colour of the progress bar shown when loading new data. |
| `colorDebug` | `String` | `'#1e90ff'` | Colour used to highlight certain aspects when using the `debug` mode. |
| `colorDebugEmphasized` | `String` | `'#f00'` | Colour used to highlight very important aspects when using the `debug` mode. |
| `attribution` | `String` | `'&copy; <a href="http://www.uni-heidelberg.de">Heidelberg University</a>'` | Attribution to be shown. |
| `renderer` | `'webgl'|'svg'` | `'webgl'` | Renderer to be used.  The WebGL renderer (default choice) is much faster than the SVG renderer, but the SVG renderer might offer advantages in some scenarios where a interaction is crucial. |

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
  this.setCellColor(e.cell.id, 'blue')
}
```

The following methods of the `ISEA3HLayerPlugin` are available:

| Method | Description |
| ------ | ----------- |
| `setCellColor(id, color)` | Fills the grid cell with ID `id` by the colour `color`.  If `color` is `null`, the colour of the grid cell is computed using `colorGridFillData` and `colorGridFillNoData`. |
| `setCellSize(id, size)` | Resizes the grid cell with ID `id` by the relative size `size`.  If `size` is `null`, the relative size of the grid cell is computed using `sizeGridData` and `sizeGridNoData`. |
| `render()` | Forces the layer to render.  This method is to be used after having changed the color or the size of a grid cell, etc. |

## Build geogrid.min.js

The library can be translated from [ECMAScript 6](https://en.wikipedia.org/wiki/ECMAScript) to minified JavaScript, which results in a file `geogrid.min.js`.  In order to generate this minified file, you have to install [Node.js](https://nodejs.org/) first.  Thereafter, you have to execute the following commands:

```bash
npm install
npm run build
```

The resulting minified file can be found in the subdirectory `dist`, which is created during this process.  In addition, a [JavaScript Source Map](https://developer.mozilla.org/en-US/docs/Tools/Debugger/How_to/Use_a_source_map) is created.

## Author

This software is written and maintained by Franz-Benjamin Mocnik, <mocnik@uni-heidelberg.de>, GIScience Research Group, Institute of Geography, Heidelberg University.

The development has been supported by the DFG project *A framework for measuring the fitness for purpose of OpenStreetMap data based on intrinsic quality indicators* (FA 1189/3-1).

(c) by Heidelberg University, 2017.

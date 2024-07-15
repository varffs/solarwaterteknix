// include redux

import pkg from "@reduxjs/toolkit";
const { configureStore, createListenerMiddleware } = pkg;

// include io, sensors and display libraries

import i2c from "i2c-bus";

import oled from "oled-i2c-bus";
import font from "oled-font-5x7";

import ds18b20 from "ds18b20";

import { Gpio } from "onoff";

// include misc

import pngparse from "pngparse";
const egg1FilePath = "./assets/egg1.png";

// variables

const minsPerDataPoint = .5;
const dataPollingInterval = 1000 * 60 * minsPerDataPoint;

// functions

const formatFloat = (number, decimalPlaces = 1) => {
  if (number === null) {
    return 0;
  }

  let rounded = Math.round((number + Number.EPSILON) * 100) / 100;

  return rounded.toFixed(decimalPlaces);
};

// setup display

const i2cBus = i2c.openSync(1);
const opts = {
  width: 128,
  height: 64,
  address: 0x3c,
};

const display = new oled(i2cBus, opts);
display.clearDisplay();

// setup basic redux state

const initialState = {
  data: {
    temperature_water: null,
    temperature_room: null,
    humidity_room: null,
  },
  display: {
    mode: "DEFAULT"
  }
};

// setup display states array map

const displayStates = [
  "DEFAULT",
  "ROOM",
  "DATA",
  "EGG1",
];

// render function for the display

const renderDisplay = (state) => {
  display.clearDisplay();

  switch (state.display.mode) {
    case "DEFAULT":
      display.setCursor(1, 1);
      display.writeString(font, 2, 'Water Temp', 1, true);
      display.setCursor(1, 30);
      display.writeString(
        font,
        3,
        `${formatFloat(state.data.temperature_water)}°c`,
        1,
        true
      );
      break;
    case "ROOM":
      display.setCursor(1, 1);
      display.writeString(font, 2, "Room", 1, true);
      display.setCursor(1, 30);
      display.writeString(
        font,
        2,
        `${formatFloat(state.data.temperature_room)}°c & ${formatFloat(
          state.data.humidity_room
        )}%`,
        1,
        true
      );
      break;
    case "DATA":
      display.setCursor(1, 1);
      display.writeString(font, 1, "DATA", 1, true);
      break;
    case "EGG1":
      pngparse.parseFile(egg1FilePath, function (err, image) {
        if (err) {
          console.log(err);
        }

        console.log(image);

        display.drawBitmap(image.data);
      });
      break;
    default:
      display.setCursor(1, 1);
      display.writeString(font, 2, "HOW U GET HERE?", 1, true);
      break;
  }
}

// create a reducer function

function appReducer(state = initialState, action) {
  switch (action.type) {
    case "data/water/temperature":
      return {
        ...state,
        data: {
          ...state.data,
          temperature_water: action.payload,
        },
      };
    case "data/room/temperature":
      return {
        ...state,
        data: {
          ...state.data,
          temperature_room: action.payload,
        },
      };
    case "data/room/humidity":
      return {
        ...state,
        data: {
          ...state.data,
          humidity_room: action.payload,
        },
      };
    case "display/next":
      if (displayStates.indexOf(state.display.mode) === displayStates.length - 1) {
        return {
          ...state,
          display: {
            ...state.display,
            mode: displayStates[0],
          },
        };
      }

      return {
        ...state,
        display: {
          ...state.display,
          mode: displayStates[displayStates.indexOf(state.display.mode) + 1],
        },
      };
    
    default:
      return state;
  }
}

// create listener middleware to conditionally render the display
const listenerMiddleware = createListenerMiddleware()

listenerMiddleware.startListening({
  type: 'display/next',
  effect: (action, listenerApi) => {
    const state = listenerApi.getState();
    
    renderDisplay(state);
  },
});

listenerMiddleware.startListening({
  type: 'data/water/temperature',
  effect: (action, listenerApi) => {
    const state = listenerApi.getState();

    if (state.display.mode === 'DEFAULT' || state.display.mode === 'DATA') {
      renderDisplay(state);
    }
  },
});

// create a store

let store = configureStore({
  reducer: appReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().prepend(listenerMiddleware.middleware),
});

// subscribe to store to render the display

// store.subscribe(() => {
//   console.log(store.getState());
// });

// setup data polling

const dataPoll = setInterval(() => {
  ds18b20.sensors((err, ids) => { // refactor this to use a single sensor id
    if (err) {
      console.log(err);
    } else {
      ds18b20.temperature(ids[0], function (err, value) {
        if (err) {
          console.log(err);
        } else {
          store.dispatch({
            type: "data/water/temperature",
            payload: value,
          });
        }
      });
    }
  });
}, dataPollingInterval);

// listen to the button press

const button1 = new Gpio(17, "in", "rising", { debounceTimeout: 10 });
const button2 = new Gpio(27, "in", "rising", { debounceTimeout: 10 });

button1.watch((err, value) => {
  if (err) {
    console.log(err);
  } else {
    store.dispatch({
      type: "display/next",
    });
  }
});

button2.watch((err, value) => {
  if (err) {
    console.log(err);
  } else {
    const state = store.getState();

    switch (state.display.mode) {
      case "DEFAULT":
        console.log("Default action");
        break;
      case "ROOM":
        console.log("Room action");
        break;
      case "DATA":
        console.log("Data action");
        break;
      case "EGG1":
        console.log("You just cracked the egg!");
        display.invertDisplay(true);
        break;
      default:
        store.dispatch({
          type: "display/next",
        });
        break;
    }
    
  }
});

// cleanup

process.on("SIGINT", () => {
  button1.unexport();
  button2.unexport();
  clearInterval(dataPoll);
  display.turnOffDisplay();
  i2cBus.closeSync();
  process.exit();
});
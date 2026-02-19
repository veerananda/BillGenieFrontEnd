import { registerRootComponent } from 'expo';
import { enableScreens } from 'react-native-screens';

// Disable native screens as early as possible to avoid native view manager
// property type mismatches (string -> boolean) while debugging.
enableScreens(true);

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

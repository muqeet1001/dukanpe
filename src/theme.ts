import { Platform } from 'react-native';

export const colors = {
  navy: '#002970',
  deep: '#062B5C',
  cyan: '#00B9F1',
  blue: '#00A6E2',
  sky: '#EAF8FE',
  ice: '#F3FAFD',
  background: '#F5F5F5',
  white: '#FFFFFF',
  text: '#141414',
  muted: '#747474',
  line: '#EEEEEE',
  green: '#159B72',
  greenLight: '#EAF8F1',
  amber: '#B67C16',
  amberLight: '#FFF5DE',
  pink: '#F8EAF1',
};
const systemFont = Platform.OS === 'ios' ? 'System' : 'sans-serif';
export const fonts = { regular: systemFont, medium: systemFont, semi: systemFont, bold: systemFont, extra: systemFont };

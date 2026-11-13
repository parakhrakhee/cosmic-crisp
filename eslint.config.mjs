import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'cosmic-crisp/**/*'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];

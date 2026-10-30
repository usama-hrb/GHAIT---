import { library } from '@fabric/config-eslint/library';

// core imports nothing: no npm packages, no Node builtins (BUILD_PROMPTS §1.3).
export default library({ rootDir: import.meta.dirname });

// This file extends the AdapterConfig type from "@types/iobroker"


// Augment the globally declared type ioBroker.AdapterConfig
declare global {
	type ConfigMapping = {[index: string]: {[index: string]: boolean}};

	namespace ioBroker {
		interface AdapterConfig {
			mapping: ConfigMapping
		}
	}
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
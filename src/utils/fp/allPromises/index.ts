const allPromises = <T, U>(action: (arg0: T) => Promise<U>, promises: T[]): Promise<U[]> => Promise.all(promises.map(action));

export default allPromises;

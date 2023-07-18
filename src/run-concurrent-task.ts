/**
 * 并发执行任务
 * @param concurrentTasks
 * @param concurrentNumber
 * @returns {Promise<unknown>}
 */
export function runConcurrentTasks<T>(concurrentTasks: Promise<T>[], concurrentNumber: number): Promise<T[]> {
  console.info(`共有 ${concurrentTasks.length} 个任务，最大并发数为 ${concurrentNumber}`);
  return new Promise((resolve, reject) => {
    let index = 0;
    let results = [];
    let running = 0;

    function runTask(task) {
      running++;
      const currentTaskIndex = index;
      task()
        .then((result) => {
          console.log(`🚩🚩🚩🚩 第 ${currentTaskIndex + 1} 个任务执行完毕 🚩🚩🚩🚩`);
          results.push(result);
          running--;
          tryRunTasks();
        })
        .catch((error) => {
          reject(error);
        });
    }

    function tryRunTasks() {
      while (running < concurrentNumber && index < concurrentTasks.length) {
        console.log(`正在执行第 ${index + 1} 个任务...`);
        runTask(concurrentTasks[index]);
        index++;
      }
      if (running === 0 && index === concurrentTasks.length) {
        resolve(results);
      }
    }
    tryRunTasks();
  });
}

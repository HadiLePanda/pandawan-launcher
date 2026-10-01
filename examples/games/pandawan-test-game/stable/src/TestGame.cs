using System;
using System.IO;
using System.Threading;

namespace PandawanTestGame
{
    /// Minimal stand-in for a real game binary.
    ///
    /// The launcher only cares that the manifest's `executable` starts as a
    /// process, exits on its own (so the `game-exited` event and playtime
    /// accounting get exercised), and exits 0. This does exactly that and writes
    /// a marker file so a test run can prove the expected build actually
    /// launched rather than a stale install.
    internal static class Program
    {
        private static readonly string MarkerPath = Path.Combine(
            AppDomain.CurrentDomain.BaseDirectory,
            "test-game-ran.txt");

        private static int Main(string[] args)
        {
            try
            {
                string launcherId = "(none)";
                for (int i = 0; i < args.Length - 1; i++)
                {
                    if (args[i] == "-launcher")
                    {
                        launcherId = args[i + 1];
                    }
                }

                File.AppendAllText(
                    MarkerPath,
                    string.Format(
                        "launched at {0:o} args=[{1}] launcher={2}{3}",
                        DateTime.UtcNow,
                        string.Join(" ", args),
                        launcherId,
                        Environment.NewLine));

                Console.WriteLine("Pandawan Test Game running. Exiting in 3 seconds.");
                Console.WriteLine("Launcher id: " + launcherId);

                Thread.Sleep(3000);
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Test game failed: " + ex.Message);
                return 1;
            }
        }
    }
}
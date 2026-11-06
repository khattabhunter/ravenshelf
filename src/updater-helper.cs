// Windows-only portable updater. No shell, script interpreter, network access,
// privilege elevation, process termination, or security-policy changes.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

internal static class RavenshelfUpdater
{
    const long MaximumSize = 536870912;
    const uint Read = 0x80000000, Write = 0x40000000, ShareRead = 1, ShareWrite = 2;
    const uint Existing = 3, NewFile = 1, OpenReparsePoint = 0x00200000, BackupSemantics = 0x02000000;
    const uint DirectoryAttribute = 0x10, ReparseAttribute = 0x400;
    static readonly List<SafeFileHandle> DirectoryLocks = new List<SafeFileHandle>();
    static readonly HashSet<string> LockedDirectories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    [StructLayout(LayoutKind.Sequential)]
    struct FileInformation
    {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, WriteTime;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
        public long Size { get { return ((long)SizeHigh << 32) | SizeLow; } }
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFile(string name, uint access, uint sharing, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint GetFileType(SafeFileHandle handle);

    static Exception Invalid() { return new InvalidDataException("Invalid or changed update data."); }
    static string OrdinaryPath(string value)
    {
        if (String.IsNullOrEmpty(value) || !Regex.IsMatch(value, @"^[A-Za-z]:\\") || value.IndexOf('/') >= 0 || value.Substring(2).IndexOf(':') >= 0) throw Invalid();
        string full = Path.GetFullPath(value);
        if (!String.Equals(full, value, StringComparison.OrdinalIgnoreCase)) throw Invalid();
        foreach (string segment in full.Substring(3).Split('\\'))
        {
            if (segment.Length == 0 || segment == "." || segment == ".." || segment.EndsWith(".") || segment.EndsWith(" ") ||
                segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || Regex.IsMatch(segment, @"^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)", RegexOptions.IgnoreCase)) throw Invalid();
        }
        LockDirectory(Path.GetDirectoryName(full));
        return full;
    }
    static void LockDirectory(string directory)
    {
        if (LockedDirectories.Contains(directory)) return;
        string parent = Path.GetDirectoryName(directory);
        if (!String.IsNullOrEmpty(parent)) LockDirectory(parent);
        SafeFileHandle handle = CreateFile(directory, 0x80, ShareRead | ShareWrite, IntPtr.Zero, Existing, OpenReparsePoint | BackupSemantics, IntPtr.Zero);
        if (handle.IsInvalid) { handle.Dispose(); throw Invalid(); }
        try
        {
            FileInformation information;
            if (!GetFileInformationByHandle(handle, out information) || GetFileType(handle) != 1 ||
                (information.Attributes & DirectoryAttribute) == 0 || (information.Attributes & ReparseAttribute) != 0) throw Invalid();
            DirectoryLocks.Add(handle); LockedDirectories.Add(directory);
        }
        catch { handle.Dispose(); throw; }
    }
    static FileInformation Information(FileStream stream)
    {
        FileInformation information;
        if (!GetFileInformationByHandle(stream.SafeFileHandle, out information) || GetFileType(stream.SafeFileHandle) != 1 ||
            (information.Attributes & (DirectoryAttribute | ReparseAttribute)) != 0 || information.Links != 1 ||
            (information.IndexHigh == 0 && information.IndexLow == 0)) throw Invalid();
        return information;
    }
    static FileStream Open(string file, bool create)
    {
        OrdinaryPath(file);
        // Deny concurrent writes and deletion while validating or copying a file.
        SafeFileHandle handle = CreateFile(file, create ? Read | Write : Read, create ? 0 : ShareRead, IntPtr.Zero,
            create ? NewFile : Existing, OpenReparsePoint, IntPtr.Zero);
        if (handle.IsInvalid) { handle.Dispose(); throw new IOException("Update file unavailable."); }
        FileStream stream = null;
        try { stream = new FileStream(handle, create ? FileAccess.ReadWrite : FileAccess.Read, 65536, false); Information(stream); return stream; }
        catch { if (stream != null) stream.Dispose(); else handle.Dispose(); throw; }
    }
    static string Hash(FileStream file, long expectedSize, bool requireExecutable)
    {
        FileInformation before = Information(file);
        if (before.Size < 64 || before.Size > MaximumSize || (expectedSize >= 0 && before.Size != expectedSize)) throw Invalid();
        file.Position = 0;
        if (requireExecutable && (file.ReadByte() != 0x4d || file.ReadByte() != 0x5a)) throw Invalid();
        file.Position = 0;
        string digest;
        using (SHA256 sha = SHA256.Create()) digest = BitConverter.ToString(sha.ComputeHash(file)).Replace("-", "").ToLowerInvariant();
        FileInformation after = Information(file);
        if (before.Size != after.Size || before.Volume != after.Volume || before.IndexHigh != after.IndexHigh || before.IndexLow != after.IndexLow) throw Invalid();
        file.Position = 0;
        return digest;
    }
    static string Text(Dictionary<string, object> data, string name)
    {
        object value; if (!data.TryGetValue(name, out value) || !(value is string)) throw Invalid(); return (string)value;
    }
    static long Integer(Dictionary<string, object> data, string name)
    {
        object value; if (!data.TryGetValue(name, out value) || (!(value is int) && !(value is long))) throw Invalid(); return Convert.ToInt64(value);
    }
    static void Result(string root, bool success, bool restored)
    {
        if (root == null) return;
        try
        {
            // Never follow or overwrite a preexisting result file, including a hard link.
            using (FileStream result = Open(Path.Combine(root, "result.json"), true))
            {
                string json = success ? "{\"success\":true,\"versionInstalled\":true}" :
                    "{\"success\":false,\"restored\":" + (restored ? "true" : "false") + ",\"message\":\"Automatic update could not finish. Check Ravenshelf before trying again.\"}";
                byte[] bytes = Encoding.UTF8.GetBytes(json); result.Write(bytes, 0, bytes.Length); result.Flush(true);
            }
        }
        catch { /* Fixed results are best effort and never expose exception text. */ }
    }
    static void WaitForApplication(int pid)
    {
        if (pid <= 0 || pid == Process.GetCurrentProcess().Id) throw Invalid();
        Process process;
        try { process = Process.GetProcessById(pid); }
        catch (ArgumentException) { return; }
        using (process) if (!process.WaitForExit(60000)) throw Invalid();
    }
    static bool SharingFailure(IOException error)
    {
        int code = Marshal.GetHRForException(error) & 0xffff;
        return code == 5 || code == 32 || code == 33;
    }
    [STAThread]
    static int Main(string[] args)
    {
        string jobRoot = null, target = null, temporary = null, backup = null, previousHash = null, expectedHash = null;
        bool replaced = false, restored = false;
        try
        {
            if (args.Length != 1) throw Invalid();
            string job = OrdinaryPath(args[0]);
            if (Path.GetFileName(job) != "job.json") throw Invalid();
            jobRoot = Path.GetDirectoryName(job);
            if (!String.Equals(Path.GetDirectoryName(typeof(RavenshelfUpdater).Assembly.Location), jobRoot, StringComparison.OrdinalIgnoreCase)) throw Invalid();
            Dictionary<string, object> data;
            using (FileStream input = Open(job, false))
            {
                if (Information(input).Size > 16384) throw Invalid();
                using (StreamReader reader = new StreamReader(input, Encoding.UTF8, true, 4096))
                {
                    JavaScriptSerializer serializer = new JavaScriptSerializer(); serializer.MaxJsonLength = 16384; serializer.RecursionLimit = 8;
                    data = serializer.DeserializeObject(reader.ReadToEnd()) as Dictionary<string, object>;
                }
            }
            string[] fields = { "target", "staged", "sha256", "size", "previousSha256", "pid", "restart", "nonce", "result" };
            if (data == null || data.Count != fields.Length) throw Invalid();
            foreach (string field in fields) if (!data.ContainsKey(field)) throw Invalid();
            expectedHash = Text(data, "sha256"); previousHash = Text(data, "previousSha256");
            Guid nonce;
            if (!Regex.IsMatch(expectedHash, "^[a-f0-9]{64}$") || !Regex.IsMatch(previousHash, "^[a-f0-9]{64}$") || !Guid.TryParseExact(Text(data, "nonce"), "D", out nonce) || !(data["restart"] is bool)) throw Invalid();
            long size = Integer(data, "size"), pid = Integer(data, "pid");
            if (size < 64 || size > MaximumSize || pid <= 0 || pid > Int32.MaxValue) throw Invalid();
            target = OrdinaryPath(Text(data, "target"));
            string staged = OrdinaryPath(Text(data, "staged"));
            if (!String.Equals(staged, Path.Combine(jobRoot, "update.exe"), StringComparison.OrdinalIgnoreCase) ||
                !String.Equals(OrdinaryPath(Text(data, "result")), Path.Combine(jobRoot, "result.json"), StringComparison.OrdinalIgnoreCase) ||
                !Regex.IsMatch(Path.GetFileName(target), @"^Ravenshelf[-\w. ()]*\.exe$", RegexOptions.IgnoreCase) ||
                String.Equals(target, typeof(RavenshelfUpdater).Assembly.Location, StringComparison.OrdinalIgnoreCase)) throw Invalid();
            string parent = Path.GetDirectoryName(target);
            using (FileStream source = Open(staged, false))
            {
                if (Hash(source, size, true) != expectedHash) throw Invalid();
                using (FileStream current = Open(target, false)) if (Hash(current, -1, true) != previousHash) throw Invalid();
                WaitForApplication((int)pid);
                // Fresh unpredictable names prevent planted predictable temporary links.
                string unique = Guid.NewGuid().ToString("N");
                temporary = Path.Combine(parent, ".ravenshelf-update-" + unique + ".exe");
                // Use a different unannounced nonce for the backup: observing
                // temporary-file creation must not reveal its future filename.
                backup = Path.Combine(parent, ".ravenshelf-rollback-" + Guid.NewGuid().ToString("N") + ".exe");
                OrdinaryPath(backup); if (File.Exists(backup) || Directory.Exists(backup)) throw Invalid();
                using (FileStream destination = Open(temporary, true)) { source.Position = 0; source.CopyTo(destination, 65536); destination.Flush(true); }
                for (int attempt = 0; attempt < 120; attempt++)
                {
                    using (FileStream copy = Open(temporary, false)) if (Hash(copy, size, true) != expectedHash) throw Invalid();
                    using (FileStream current = Open(target, false)) if (Hash(current, -1, true) != previousHash) throw Invalid();
                    if (File.Exists(backup) || Directory.Exists(backup)) throw Invalid();
                    try { File.Replace(temporary, target, backup, true); replaced = true; temporary = null; break; }
                    catch (IOException error) { if (!SharingFailure(error) || attempt == 119) throw; Thread.Sleep(500); }
                    catch (UnauthorizedAccessException) { if (attempt == 119) throw; Thread.Sleep(500); }
                }
                if (!replaced) throw Invalid();
                using (FileStream previous = Open(backup, false)) if (Hash(previous, -1, true) != previousHash) throw Invalid();
                using (FileStream installed = Open(target, false))
                {
                    if (Hash(installed, size, true) != expectedHash) throw Invalid();
                    if ((bool)data["restart"])
                    {
                        // The verified target stays locked against replacement until
                        // CreateProcess has opened its executable image.
                        ProcessStartInfo start = new ProcessStartInfo(target); start.UseShellExecute = false; start.WorkingDirectory = parent;
                        using (Process restarted = Process.Start(start)) { if (restarted == null) throw Invalid(); }
                    }
                }
            }
            Result(jobRoot, true, false); return 0;
        }
        catch
        {
            if (replaced && backup != null && target != null)
            {
                try
                {
                    using (FileStream old = Open(backup, false)) if (Hash(old, -1, true) != previousHash) throw Invalid();
                    if (File.Exists(target))
                    {
                        using (FileStream current = Open(target, false)) if (Hash(current, -1, true) != expectedHash) throw Invalid();
                        File.Replace(backup, target, null, true);
                    }
                    else File.Move(backup, target);
                    restored = true;
                }
                catch { /* Do not overwrite a target changed by somebody else. */ }
            }
            Result(jobRoot, false, restored); return 1;
        }
        finally
        {
            if (temporary != null) try { File.Delete(temporary); } catch { }
            for (int i = DirectoryLocks.Count - 1; i >= 0; i--) DirectoryLocks[i].Dispose();
        }
    }
}

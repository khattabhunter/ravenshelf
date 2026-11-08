// Ravenshelf browser connector (Windows). A browser starts this program to
// deliver one message from the Ravenshelf extension. It relays the message to
// the running Ravenshelf app over a local named pipe, proving itself with the
// session token the app wrote next to this program, and returns the reply.
// No network access, no file writes, no process launching, no shell.
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal sealed class NotRunningException : Exception { }

internal static class RavenshelfBrowserHost
{
    const int MaximumRequest = 65536;
    const int MaximumResponse = 1000000;
    const int MaximumEndpoint = 4096;
    const int ConnectTimeout = 3000;
    const int ReplyTimeout = 30000;
    static readonly Regex PipeName = new Regex("^ravenshelf-[0-9a-f]{32}$");
    static readonly Regex Token = new Regex("^[0-9a-f]{64}$");
    static readonly Regex OriginText = new Regex("^[A-Za-z0-9@._:/-]{1,200}$");
    static readonly UTF8Encoding StrictUtf8 = new UTF8Encoding(false, true);

    static int Main(string[] args)
    {
        Stream input = Console.OpenStandardInput();
        Stream output = Console.OpenStandardOutput();
        byte[] request;
        try
        {
            request = ReadFrame(input, MaximumRequest);
            ParseObject(request);
        }
        catch (Exception)
        {
            return Reply(output, "invalid");
        }
        string[] endpoint = ReadEndpoint();
        if (endpoint == null) return Reply(output, "not-running");
        string origin = OriginFrom(args);
        try
        {
            Task<byte[]> exchange = Task.Run(() => Exchange(endpoint[0], endpoint[1], origin, request));
            if (!exchange.Wait(ConnectTimeout + ReplyTimeout)) return Reply(output, "timeout");
            byte[] response = exchange.Result;
            ParseObject(response);
            WriteFrame(output, response);
            output.Flush();
            return 0;
        }
        catch (AggregateException error)
        {
            return Reply(output, error.GetBaseException() is NotRunningException ? "not-running" : "failed");
        }
        catch (Exception)
        {
            return Reply(output, "failed");
        }
    }

    static byte[] Exchange(string pipeName, string token, string origin, byte[] request)
    {
        using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.None))
        {
            try { pipe.Connect(ConnectTimeout); }
            catch (TimeoutException) { throw new NotRunningException(); }
            catch (IOException) { throw new NotRunningException(); }
            Dictionary<string, object> header = new Dictionary<string, object>();
            header["v"] = 1;
            header["token"] = token;
            header["origin"] = origin;
            WriteFrame(pipe, StrictUtf8.GetBytes(new JavaScriptSerializer().Serialize(header)));
            WriteFrame(pipe, request);
            pipe.Flush();
            return ReadFrame(pipe, MaximumResponse);
        }
    }

    // Chrome, Edge and Brave pass the extension origin first. Firefox passes the
    // manifest path and then the extension ID. The app checks the result.
    static string OriginFrom(string[] args)
    {
        string origin = "unknown";
        if (args.Length >= 1 && args[0].StartsWith("chrome-extension://", StringComparison.Ordinal)) origin = args[0];
        else if (args.Length >= 2) origin = "firefox:" + args[1];
        return OriginText.IsMatch(origin) ? origin : "unknown";
    }

    // The app writes {"schema":1,"pipe":"ravenshelf-<hex>","token":"<hex>"} next
    // to this program while it is running and removes it when it closes.
    static string[] ReadEndpoint()
    {
        try
        {
            string file = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "endpoint.json");
            FileInfo info = new FileInfo(file);
            if (!info.Exists || info.Length > MaximumEndpoint) return null;
            Dictionary<string, object> value = ParseObject(File.ReadAllBytes(file));
            object schema, pipe, token;
            if (!value.TryGetValue("schema", out schema) || !(schema is int) || (int)schema != 1) return null;
            if (!value.TryGetValue("pipe", out pipe) || !(pipe is string) || !PipeName.IsMatch((string)pipe)) return null;
            if (!value.TryGetValue("token", out token) || !(token is string) || !Token.IsMatch((string)token)) return null;
            return new string[] { (string)pipe, (string)token };
        }
        catch (Exception)
        {
            return null;
        }
    }

    static Dictionary<string, object> ParseObject(byte[] bytes)
    {
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        serializer.MaxJsonLength = MaximumResponse * 2;
        Dictionary<string, object> value = serializer.DeserializeObject(StrictUtf8.GetString(bytes)) as Dictionary<string, object>;
        if (value == null) throw new InvalidDataException("Expected a JSON object.");
        return value;
    }

    static byte[] ReadExactly(Stream stream, int count)
    {
        byte[] buffer = new byte[count];
        int offset = 0;
        while (offset < count)
        {
            int read = stream.Read(buffer, offset, count - offset);
            if (read <= 0) throw new EndOfStreamException();
            offset += read;
        }
        return buffer;
    }

    static byte[] ReadFrame(Stream stream, int maximum)
    {
        byte[] prefix = ReadExactly(stream, 4);
        long length = (long)prefix[0] | ((long)prefix[1] << 8) | ((long)prefix[2] << 16) | ((long)prefix[3] << 24);
        if (length < 2 || length > maximum) throw new InvalidDataException("Invalid message length.");
        return ReadExactly(stream, (int)length);
    }

    static void WriteFrame(Stream stream, byte[] body)
    {
        byte[] prefix = new byte[] { (byte)body.Length, (byte)(body.Length >> 8), (byte)(body.Length >> 16), (byte)(body.Length >> 24) };
        stream.Write(prefix, 0, 4);
        stream.Write(body, 0, body.Length);
    }

    static int Reply(Stream output, string error)
    {
        try
        {
            WriteFrame(output, StrictUtf8.GetBytes("{\"ok\":false,\"error\":\"" + error + "\"}"));
            output.Flush();
        }
        // The browser has already gone, so there is no one left to answer.
        catch (Exception) { }
        return 0;
    }
}
